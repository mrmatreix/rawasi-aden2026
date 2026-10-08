/**
 * إدارة إعدادات النظام، بيانات الشركة، النسخ الاحتياطي، والمستخدمين والصلاحيات - رواسي عدن
 */

const Settings = {
  _cachedUsers: [],
  _selectedBackupFile: null,
  _selectedServerBackupName: null,
  _printConfig: null,
  activeTab: 'users',

  async init() {
    await this.loadCompanySettings();
    await this.loadPrintSettings();
    await this.loadUsers();
  },

  // ================== تبديل تبويبات الإعدادات ==================
  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.settings-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.report-tabs-bar .report-tab-btn').forEach(b => b.classList.remove('active'));

    const activePane = document.getElementById(`pane_settings_${tab}`);
    const activeBtn = document.getElementById(`tabBtn_settings_${tab}`);
    if (activePane) activePane.style.display = 'block';
    if (activeBtn) activeBtn.classList.add('active');

    if (tab === 'users') {
      this.loadUsers();
      if (typeof Auth !== 'undefined' && Auth.updateLockTimeoutBadge) Auth.updateLockTimeoutBadge();
    } else if (tab === 'company') {
      this.loadCompanySettings();
    } else if (tab === 'print') {
      this.loadPrintSettings();
    } else if (tab === 'backup') {
      this.loadDbConfig();
      this.loadAutoBackupSchedule();
      this.loadLogoutBackups();
      this.loadMysqlStatus();
      this.loadCloudBackupStatus();
    }
  },

  // ================== إعدادات الشركة ==================
  async loadCompanySettings() {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        const s = json.data;
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };

        setVal('setCompanyName', s.company_name);
        setVal('setPhone1', s.phone1);
        setVal('setPhone2', s.phone2);
        setVal('setEmail', s.email);
        setVal('setAddress', s.address);
        setVal('setSlogan', s.slogan);

        // تحديث تذييل الصفحة (Footer)
        this.updateFooter(s);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  },

  updateFooter(s) {
    if (!s) return;
    const phoneEl = document.getElementById('footerPhone');
    if (phoneEl) {
      if (s.phone1 && s.phone2 && s.phone1 !== s.phone2) {
        phoneEl.textContent = `${s.phone1} / ${s.phone2}`;
      } else {
        phoneEl.textContent = s.phone1 || s.phone2 || '773413937';
      }
    }
    const emailEl = document.getElementById('footerEmail');
    if (emailEl && s.email) emailEl.textContent = s.email;
    const addressEl = document.getElementById('footerAddress');
    if (addressEl && s.address) addressEl.textContent = s.address;
    const sloganEl = document.getElementById('footerSlogan');
    if (sloganEl && s.slogan) sloganEl.textContent = s.slogan;
  },

  async saveCompanySettings(e) {
    if (e) e.preventDefault();
    const updates = {
      company_name: document.getElementById('setCompanyName')?.value,
      phone1: document.getElementById('setPhone1')?.value,
      phone2: document.getElementById('setPhone2')?.value,
      email: document.getElementById('setEmail')?.value,
      address: document.getElementById('setAddress')?.value,
      slogan: document.getElementById('setSlogan')?.value
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        this.updateFooter(updates);
        App.showToast('تم حفظ وتحديث بيانات الشركة بنجاح وتم التأكيد في قاعدة البيانات!', 'success');
      }
    } catch (e) {
      App.showToast('تعذر حفظ الإعدادات', 'error');
    }
  },

  _previewDocType: 'receipt',

  // ================== تخصيص ورقة الطباعة والتقارير ==================
  getPrintConfig() {
    if (this._printConfig) return this._printConfig;
    const defaults = {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      slogan: 'نبني الحاضر لنستثمر المستقبل',
      header_style: 'dynamic',
      table_density: 'medium',
      page_margins: 'normal',
      orientation: 'portrait',
      sig_position: 'end',
      logo_size: 'medium',
      font_family: 'Cairo',
      font_size_scale: 'normal',
      show_logo: '1',
      show_stamp: '0',
      show_page_numbers: '1',
      show_print_time: '1',
      sig1: 'المستلم / المحاسب',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      border_style: 'classic',
      accent_color: '#d4af37',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ولا يعتمد أي كشط أو تعديل بدون ختم الإدارة',
      receipt_title: 'سـنـد قـبـض رسـمـي',
      expense_title: 'سـنـد صـرف رسـمـي',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1',
      stmt_show_summary_card: '1',
      stmt_show_running_balance: '1',
      stmt_show_reference: '1',
      stmt_show_notes: '1',
      stmt_show_match_sig: '1',
      proj_show_kpi_cards: '1',
      proj_show_expenses_table: '1',
      proj_show_supplier_bills: '1',
      proj_show_client_payments: '1',
      proj_show_tasks: '1',
      fin_show_kpi_cards: '1',
      fin_show_expense_breakdown: '1',
      fin_show_dual_balance: '1'
    };

    try {
      const cached = localStorage.getItem('rawasi_print_config');
      if (cached) {
        this._printConfig = Object.assign({}, defaults, JSON.parse(cached));
        return this._printConfig;
      }
    } catch (e) {}

    this._printConfig = defaults;
    return defaults;
  },

  async loadPrintSettings() {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success && json.data) {
        const s = json.data;
        const cfg = {
          header_title: s.print_header_title || s.company_name || 'شركة رواسي عدن للهندسة والمقاولات',
          header_subtitle: s.print_header_subtitle || (s.address ? `${s.address} | هاتف: ${s.phone1 || '773413937'}` : 'عدن - الجمهورية اليمنية | هاتف: 773413937'),
          header_en: s.print_header_en || 'Rawasi Aden for Engineering & Contracting',
          tax_no: s.print_tax_no || 'س.ت: 102948 - ر.ض: 3004918',
          slogan: s.print_slogan || s.slogan || 'نبني الحاضر لنستثمر المستقبل',
          header_style: s.print_header_style || 'dynamic',
          table_density: s.print_table_density || 'medium',
          page_margins: s.print_page_margins || 'normal',
          orientation: s.print_orientation || 'portrait',
          sig_position: s.print_sig_position || 'end',
          logo_size: s.print_logo_size || 'medium',
          font_family: s.print_font_family || 'Cairo',
          font_size_scale: s.print_font_size_scale || 'normal',
          show_logo: s.print_show_logo !== undefined ? String(s.print_show_logo) : '1',
          show_stamp: s.print_show_stamp !== undefined ? String(s.print_show_stamp) : '0',
          show_page_numbers: s.print_show_page_numbers !== undefined ? String(s.print_show_page_numbers) : '1',
          show_print_time: s.print_show_print_time !== undefined ? String(s.print_show_print_time) : '1',
          sig1: s.print_sig1 || 'المستلم / المحاسب',
          sig2: s.print_sig2 || 'المدير العام',
          sig3: s.print_sig3 || 'اعتماد الإدارة',
          border_style: s.print_border_style || 'classic',
          accent_color: s.print_accent_color || '#d4af37',
          footer_notes: s.print_footer_notes || 'تعتبر هذه السندات والوثائق رسمية ولا يعتمد أي كشط أو تعديل بدون ختم الإدارة',
          receipt_title: s.print_receipt_title || 'سـنـد قـبـض رسـمـي',
          expense_title: s.print_expense_title || 'سـنـد صـرف رسـمـي',
          voucher_layout: s.print_voucher_layout || 'single_a4',
          voucher_show_tafqeet: s.print_voucher_show_tafqeet !== undefined ? String(s.print_voucher_show_tafqeet) : '1',
          voucher_show_project: s.print_voucher_show_project !== undefined ? String(s.print_voucher_show_project) : '1',
          voucher_show_payment_method: s.print_voucher_show_payment_method !== undefined ? String(s.print_voucher_show_payment_method) : '1',
          voucher_show_cheque_ref: s.print_voucher_show_cheque_ref !== undefined ? String(s.print_voucher_show_cheque_ref) : '1',
          stmt_show_summary_card: s.print_stmt_show_summary_card !== undefined ? String(s.print_stmt_show_summary_card) : '1',
          stmt_show_running_balance: s.print_stmt_show_running_balance !== undefined ? String(s.print_stmt_show_running_balance) : '1',
          stmt_show_reference: s.print_stmt_show_reference !== undefined ? String(s.print_stmt_show_reference) : '1',
          stmt_show_notes: s.print_stmt_show_notes !== undefined ? String(s.print_stmt_show_notes) : '1',
          stmt_show_match_sig: s.print_stmt_show_match_sig !== undefined ? String(s.print_stmt_show_match_sig) : '1',
          proj_show_kpi_cards: s.print_proj_show_kpi_cards !== undefined ? String(s.print_proj_show_kpi_cards) : '1',
          proj_show_expenses_table: s.print_proj_show_expenses_table !== undefined ? String(s.print_proj_show_expenses_table) : '1',
          proj_show_supplier_bills: s.print_proj_show_supplier_bills !== undefined ? String(s.print_proj_show_supplier_bills) : '1',
          proj_show_client_payments: s.print_proj_show_client_payments !== undefined ? String(s.print_proj_show_client_payments) : '1',
          proj_show_tasks: s.print_proj_show_tasks !== undefined ? String(s.print_proj_show_tasks) : '1',
          fin_show_kpi_cards: s.print_fin_show_kpi_cards !== undefined ? String(s.print_fin_show_kpi_cards) : '1',
          fin_show_expense_breakdown: s.print_fin_show_expense_breakdown !== undefined ? String(s.print_fin_show_expense_breakdown) : '1',
          fin_show_dual_balance: s.print_fin_show_dual_balance !== undefined ? String(s.print_fin_show_dual_balance) : '1'
        };

        this._printConfig = cfg;
        localStorage.setItem('rawasi_print_config', JSON.stringify(cfg));

        const setInput = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };
        const setCheck = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.checked = (val === '1' || val === true || val === 1);
        };

        setInput('printHeaderTitle', cfg.header_title);
        setInput('printHeaderEn', cfg.header_en);
        setInput('printHeaderSubtitle', cfg.header_subtitle);
        setInput('printTaxNo', cfg.tax_no);
        setInput('printSlogan', cfg.slogan);
        setInput('printHeaderStyle', cfg.header_style);
        setInput('printTableDensity', cfg.table_density);
        setInput('printPageMargins', cfg.page_margins);
        setInput('printOrientation', cfg.orientation);
        setInput('printSigPosition', cfg.sig_position);
        setInput('printLogoSize', cfg.logo_size);
        setInput('printFontFamily', cfg.font_family);
        setInput('printFontSizeScale', cfg.font_size_scale);
        setCheck('printShowLogo', cfg.show_logo);
        setCheck('printShowStamp', cfg.show_stamp);
        setCheck('printShowPageNumbers', cfg.show_page_numbers);
        setCheck('printShowPrintTime', cfg.show_print_time);
        setInput('printSig1', cfg.sig1);
        setInput('printSig2', cfg.sig2);
        setInput('printSig3', cfg.sig3);
        setInput('printBorderStyle', cfg.border_style);
        setInput('printAccentColor', cfg.accent_color);
        setInput('printFooterNotes', cfg.footer_notes);

        // خصائص السندات
        setInput('printReceiptTitle', cfg.receipt_title);
        setInput('printExpenseTitle', cfg.expense_title);
        setInput('printVoucherLayout', cfg.voucher_layout);
        setCheck('printVoucherShowTafqeet', cfg.voucher_show_tafqeet);
        setCheck('printVoucherShowProject', cfg.voucher_show_project);
        setCheck('printVoucherShowPaymentMethod', cfg.voucher_show_payment_method);
        setCheck('printVoucherShowChequeRef', cfg.voucher_show_cheque_ref);

        // خصائص كشوفات الحسابات
        setCheck('printStmtShowSummaryCard', cfg.stmt_show_summary_card);
        setCheck('printStmtShowRunningBalance', cfg.stmt_show_running_balance);
        setCheck('printStmtShowReference', cfg.stmt_show_reference);
        setCheck('printStmtShowNotes', cfg.stmt_show_notes);
        setCheck('printStmtShowMatchSig', cfg.stmt_show_match_sig);

        // خصائص تقارير المشاريع
        setCheck('printProjShowKpiCards', cfg.proj_show_kpi_cards);
        setCheck('printProjShowExpensesTable', cfg.proj_show_expenses_table);
        setCheck('printProjShowSupplierBills', cfg.proj_show_supplier_bills);
        setCheck('printProjShowClientPayments', cfg.proj_show_client_payments);
        setCheck('printProjShowTasks', cfg.proj_show_tasks);

        // خصائص القوائم المالية
        setCheck('printFinShowKpiCards', cfg.fin_show_kpi_cards);
        setCheck('printFinShowExpenseBreakdown', cfg.fin_show_expense_breakdown);
        setCheck('printFinShowDualBalance', cfg.fin_show_dual_balance);

        this.updatePrintPreview();
      }
    } catch (e) {
      console.error('Error loading print settings:', e);
    }
  },

  async savePrintSettings(e) {
    if (e) e.preventDefault();

    const getVal = (id, def = '') => document.getElementById(id)?.value || def;
    const getChk = (id) => document.getElementById(id)?.checked ? '1' : '0';

    const cfg = {
      print_header_title: getVal('printHeaderTitle', 'شركة رواسي عدن للهندسة والمقاولات'),
      print_header_en: getVal('printHeaderEn', 'Rawasi Aden for Engineering & Contracting'),
      print_header_subtitle: getVal('printHeaderSubtitle', ''),
      print_tax_no: getVal('printTaxNo', ''),
      print_slogan: getVal('printSlogan', ''),
      print_header_style: getVal('printHeaderStyle', 'dynamic'),
      print_table_density: getVal('printTableDensity', 'medium'),
      print_page_margins: getVal('printPageMargins', 'normal'),
      print_orientation: getVal('printOrientation', 'portrait'),
      print_sig_position: getVal('printSigPosition', 'end'),
      print_logo_size: getVal('printLogoSize', 'medium'),
      print_font_family: getVal('printFontFamily', 'Cairo'),
      print_font_size_scale: getVal('printFontSizeScale', 'normal'),
      print_show_logo: getChk('printShowLogo'),
      print_show_stamp: getChk('printShowStamp'),
      print_show_page_numbers: getChk('printShowPageNumbers'),
      print_show_print_time: getChk('printShowPrintTime'),
      print_sig1: getVal('printSig1', 'المستلم / المحاسب'),
      print_sig2: getVal('printSig2', 'المدير العام'),
      print_sig3: getVal('printSig3', 'اعتماد الإدارة'),
      print_border_style: getVal('printBorderStyle', 'classic'),
      print_accent_color: getVal('printAccentColor', '#d4af37'),
      print_footer_notes: getVal('printFooterNotes', ''),
      
      print_receipt_title: getVal('printReceiptTitle', 'سـنـد قـبـض رسـمـي'),
      print_expense_title: getVal('printExpenseTitle', 'سـنـد صـرف رسـمـي'),
      print_voucher_layout: getVal('printVoucherLayout', 'single_a4'),
      print_voucher_show_tafqeet: getChk('printVoucherShowTafqeet'),
      print_voucher_show_project: getChk('printVoucherShowProject'),
      print_voucher_show_payment_method: getChk('printVoucherShowPaymentMethod'),
      print_voucher_show_cheque_ref: getChk('printVoucherShowChequeRef'),

      print_stmt_show_summary_card: getChk('printStmtShowSummaryCard'),
      print_stmt_show_running_balance: getChk('printStmtShowRunningBalance'),
      print_stmt_show_reference: getChk('printStmtShowReference'),
      print_stmt_show_notes: getChk('printStmtShowNotes'),
      print_stmt_show_match_sig: getChk('printStmtShowMatchSig'),

      print_proj_show_kpi_cards: getChk('printProjShowKpiCards'),
      print_proj_show_expenses_table: getChk('printProjShowExpensesTable'),
      print_proj_show_supplier_bills: getChk('printProjShowSupplierBills'),
      print_proj_show_client_payments: getChk('printProjShowClientPayments'),
      print_proj_show_tasks: getChk('printProjShowTasks'),

      print_fin_show_kpi_cards: getChk('printFinShowKpiCards'),
      print_fin_show_expense_breakdown: getChk('printFinShowExpenseBreakdown'),
      print_fin_show_dual_balance: getChk('printFinShowDualBalance')
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      });
      const data = await res.json();
      if (data.success) {
        this._printConfig = {
          header_title: cfg.print_header_title,
          header_en: cfg.print_header_en,
          header_subtitle: cfg.print_header_subtitle,
          tax_no: cfg.print_tax_no,
          slogan: cfg.print_slogan,
          header_style: cfg.print_header_style,
          table_density: cfg.print_table_density,
          page_margins: cfg.print_page_margins,
          orientation: cfg.print_orientation,
          sig_position: cfg.print_sig_position,
          logo_size: cfg.print_logo_size,
          font_family: cfg.print_font_family,
          font_size_scale: cfg.print_font_size_scale,
          show_logo: cfg.print_show_logo,
          show_stamp: cfg.print_show_stamp,
          show_page_numbers: cfg.print_show_page_numbers,
          show_print_time: cfg.print_show_print_time,
          sig1: cfg.print_sig1,
          sig2: cfg.print_sig2,
          sig3: cfg.print_sig3,
          border_style: cfg.print_border_style,
          accent_color: cfg.print_accent_color,
          footer_notes: cfg.print_footer_notes,
          receipt_title: cfg.print_receipt_title,
          expense_title: cfg.print_expense_title,
          voucher_layout: cfg.print_voucher_layout,
          voucher_show_tafqeet: cfg.print_voucher_show_tafqeet,
          voucher_show_project: cfg.print_voucher_show_project,
          voucher_show_payment_method: cfg.print_voucher_show_payment_method,
          voucher_show_cheque_ref: cfg.print_voucher_show_cheque_ref,
          stmt_show_summary_card: cfg.print_stmt_show_summary_card,
          stmt_show_running_balance: cfg.print_stmt_show_running_balance,
          stmt_show_reference: cfg.print_stmt_show_reference,
          stmt_show_notes: cfg.print_stmt_show_notes,
          stmt_show_match_sig: cfg.print_stmt_show_match_sig,
          proj_show_kpi_cards: cfg.print_proj_show_kpi_cards,
          proj_show_expenses_table: cfg.print_proj_show_expenses_table,
          proj_show_supplier_bills: cfg.print_proj_show_supplier_bills,
          proj_show_client_payments: cfg.print_proj_show_client_payments,
          proj_show_tasks: cfg.print_proj_show_tasks,
          fin_show_kpi_cards: cfg.print_fin_show_kpi_cards,
          fin_show_expense_breakdown: cfg.print_fin_show_expense_breakdown,
          fin_show_dual_balance: cfg.print_fin_show_dual_balance
        };
        localStorage.setItem('rawasi_print_config', JSON.stringify(this._printConfig));
        this.updatePrintPreview();
        App.showToast('تم حفظ وتطبيق إعدادات ورقة الطباعة بنجاح 🖨️✨', 'success');
      } else {
        App.showToast(data.message || 'خطأ في حفظ الإعدادات', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('تعذر حفظ إعدادات الطباعة', 'error');
    }
  },

  resetDefaultPrintSettings() {
    const defaults = {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      slogan: 'نبني الحاضر لنستثمر المستقبل',
      header_style: 'dynamic',
      table_density: 'medium',
      page_margins: 'normal',
      orientation: 'portrait',
      sig_position: 'end',
      logo_size: 'medium',
      font_family: 'Cairo',
      font_size_scale: 'normal',
      show_logo: '1',
      show_stamp: '0',
      show_page_numbers: '1',
      show_print_time: '1',
      sig1: 'المستلم / المحاسب',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      border_style: 'classic',
      accent_color: '#d4af37',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ولا يعتمد أي كشط أو تعديل بدون ختم الإدارة',
      receipt_title: 'سـنـد قـبـض رسـمـي',
      expense_title: 'سـنـد صـرف رسـمـي',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1',
      stmt_show_summary_card: '1',
      stmt_show_running_balance: '1',
      stmt_show_reference: '1',
      stmt_show_notes: '1',
      stmt_show_match_sig: '1',
      proj_show_kpi_cards: '1',
      proj_show_expenses_table: '1',
      proj_show_supplier_bills: '1',
      proj_show_client_payments: '1',
      proj_show_tasks: '1',
      fin_show_kpi_cards: '1',
      fin_show_expense_breakdown: '1',
      fin_show_dual_balance: '1'
    };

    const setInput = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setCheck = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = (val === '1');
    };

    setInput('printHeaderTitle', defaults.header_title);
    setInput('printHeaderEn', defaults.header_en);
    setInput('printHeaderSubtitle', defaults.header_subtitle);
    setInput('printTaxNo', defaults.tax_no);
    setInput('printSlogan', defaults.slogan);
    setInput('printHeaderStyle', defaults.header_style);
    setInput('printTableDensity', defaults.table_density);
    setInput('printPageMargins', defaults.page_margins);
    setInput('printOrientation', defaults.orientation);
    setInput('printSigPosition', defaults.sig_position);
    setInput('printLogoSize', defaults.logo_size);
    setInput('printFontFamily', defaults.font_family);
    setInput('printFontSizeScale', defaults.font_size_scale);
    setCheck('printShowLogo', defaults.show_logo);
    setCheck('printShowStamp', defaults.show_stamp);
    setCheck('printShowPageNumbers', defaults.show_page_numbers);
    setCheck('printShowPrintTime', defaults.show_print_time);
    setInput('printSig1', defaults.sig1);
    setInput('printSig2', defaults.sig2);
    setInput('printSig3', defaults.sig3);
    setInput('printBorderStyle', defaults.border_style);
    setInput('printAccentColor', defaults.accent_color);
    setInput('printFooterNotes', defaults.footer_notes);

    setInput('printReceiptTitle', defaults.receipt_title);
    setInput('printExpenseTitle', defaults.expense_title);
    setInput('printVoucherLayout', defaults.voucher_layout);
    setCheck('printVoucherShowTafqeet', defaults.voucher_show_tafqeet);
    setCheck('printVoucherShowProject', defaults.voucher_show_project);
    setCheck('printVoucherShowPaymentMethod', defaults.voucher_show_payment_method);
    setCheck('printVoucherShowChequeRef', defaults.voucher_show_cheque_ref);

    setCheck('printStmtShowSummaryCard', defaults.stmt_show_summary_card);
    setCheck('printStmtShowRunningBalance', defaults.stmt_show_running_balance);
    setCheck('printStmtShowReference', defaults.stmt_show_reference);
    setCheck('printStmtShowNotes', defaults.stmt_show_notes);
    setCheck('printStmtShowMatchSig', defaults.stmt_show_match_sig);

    setCheck('printProjShowKpiCards', defaults.proj_show_kpi_cards);
    setCheck('printProjShowExpensesTable', defaults.proj_show_expenses_table);
    setCheck('printProjShowSupplierBills', defaults.proj_show_supplier_bills);
    setCheck('printProjShowClientPayments', defaults.proj_show_client_payments);
    setCheck('printProjShowTasks', defaults.proj_show_tasks);

    setCheck('printFinShowKpiCards', defaults.fin_show_kpi_cards);
    setCheck('printFinShowExpenseBreakdown', defaults.fin_show_expense_breakdown);
    setCheck('printFinShowDualBalance', defaults.fin_show_dual_balance);

    this.updatePrintPreview();
    App.showToast('تم استعادة الإعدادات الافتراضية، اضغط حفظ للتأكيد', 'info');
  },

  // تبديل النموذج المعروض في المعاينة الحية
  setPreviewDoc(type) {
    this._previewDocType = type;
    const buttons = document.querySelectorAll('#printDocSwitcher .print-doc-pill');
    buttons.forEach(b => b.classList.remove('active'));
    
    // تفعيل الزر المناسب
    const pillMap = {
      'receipt': 0,
      'expense': 1,
      'client_stmt': 2,
      'supplier_stmt': 3,
      'project': 4,
      'profit_loss': 5,
      'balance_sheet': 6
    };
    const idx = pillMap[type];
    if (idx !== undefined && buttons[idx]) {
      buttons[idx].classList.add('active');
    }

    this.updatePrintPreview();
  },

  // طباعة تجريبية للنموذج المختار حالياً في المعاينة
  printCurrentPreviewDoc() {
    const docType = this._previewDocType || 'receipt';
    if (docType === 'receipt') {
      Accounting.printReceipt({
        receipt_no: 'RC-2026-0008',
        date: new Date().toISOString().split('T')[0],
        client_name: 'علوي محمد باعبيد',
        amount: 1500000,
        currency: 'ر.ي',
        project_name: 'مشروع برج الأمل السكني',
        payment_method: 'نقداً',
        notes: 'دفعة مستخلص أعمال هندسة ومقاولات'
      });
    } else if (docType === 'expense') {
      Accounting.printExpenseReceipt({
        receipt_no: 'PV-2026-0014',
        date: new Date().toISOString().split('T')[0],
        paid_to: 'شركة الحديد والصلب للتجارة',
        supplier_name: 'شركة الحديد والصلب للتجارة',
        expense_type: 'توريد مواد بناء',
        amount: 850000,
        currency: 'ر.ي',
        project_name: 'مشروع برج الأمل السكني',
        payment_method: 'شيك بنكي',
        notes: 'شراء حديد تسليح وإسمنت للمرحلة الأولى'
      });
    } else if (docType === 'project') {
      Projects.generateAndPrintProjectReport({
        id: 999,
        name: 'مشروع برج الأمل السكني التجاري',
        code: 'PRJ-2026-01',
        client_name: 'علوي محمد باعبيد',
        client_phone: '773413937',
        status: 'in_progress',
        progress_percentage: 65,
        start_date: '2026-01-15',
        expected_end_date: '2026-12-30',
        contract_value: 25000000,
        estimated_cost: 18000000,
        actual_cost: 12400000,
        paid_amount: 15000000,
        remaining_amount: 10000000,
        net_profit: 7000000,
        currency: 'ر.ي',
        notes: 'مشروع إنشاء مبنى سكني تجاري مكون من 7 طوابق في المعلا',
        expenses: [
          { date: '2026-02-01', title: 'حفريات وتجهيز موقع', expense_type: 'أعمال مدنية', amount: 1500000, payment_method: 'نقدي' },
          { date: '2026-03-10', title: 'صب القواعد والأساسات', expense_type: 'خرسانة جاهزة', amount: 4800000, payment_method: 'تحويل' }
        ],
        bills: [
          { date: '2026-02-20', bill_no: 'INV-401', supplier_name: 'شركة الأسمنت والخرسانة', item_name: 'إسمنت بورتلاندي', net_amount: 3200000, paid_amount: 3200000, status: 'paid' },
          { date: '2026-03-15', bill_no: 'INV-408', supplier_name: 'مؤسسة الحديد والمعدات', item_name: 'حديد تسليح 16 ملم', net_amount: 2900000, paid_amount: 2000000, status: 'partial' }
        ],
        payments: [
          { date: '2026-01-20', receipt_no: 'RC-101', amount: 5000000, payment_method: 'شيك بنكي', notes: 'دفعة مقدمة عند توقيع العقد' },
          { date: '2026-03-01', receipt_no: 'RC-105', amount: 10000000, payment_method: 'تحويل بنكي', notes: 'مستخلص إنجاز الأساسات' }
        ]
      });
    } else {
      // كشف حساب أو أرباح وخسائر أو ميزانية
      if (typeof Reports !== 'undefined') {
        const origTab = Reports.activeReportTab;
        if (docType === 'client_stmt') Reports.activeReportTab = 'client-statement';
        else if (docType === 'supplier_stmt') Reports.activeReportTab = 'supplier-statement';
        else if (docType === 'profit_loss') Reports.activeReportTab = 'profit-loss';
        else if (docType === 'balance_sheet') Reports.activeReportTab = 'balance-sheet';
        Reports.printActiveReport();
        Reports.activeReportTab = origTab;
      }
    }
  },

  // بناء فئات CSS الموحدة للتقارير والوثائق
  getReportDocClass(cfg = null) {
    const c = cfg || this.getPrintConfig();
    const borderCls = `border-${c.border_style || 'classic'}`;
    const densityCls = `density-${c.table_density || 'medium'}`;
    const marginsCls = `margins-${c.page_margins || 'normal'}`;
    const fontCls = `font-${(c.font_family || 'cairo').toLowerCase()}`;
    const scaleCls = `scale-${c.font_size_scale || 'normal'}`;
    const logoCls = `logo-size-${c.logo_size || 'medium'}`;
    const orientCls = c.orientation === 'landscape' ? 'orientation-landscape' : '';
    return `multi-page-report-document ${borderCls} ${densityCls} ${marginsCls} ${fontCls} ${scaleCls} ${logoCls} ${orientCls}`.trim();
  },

  // جلب اسم المستخدم الحالي المسجل بالنظام
  getCurrentUserName() {
    if (typeof Auth !== 'undefined' && Auth.currentUser) {
      return Auth.currentUser.full_name || Auth.currentUser.username || 'علوي محمد باعبيد';
    }
    try {
      const u = localStorage.getItem('rawasi_user');
      if (u) {
        const parsed = JSON.parse(u);
        return parsed.full_name || parsed.username || 'علوي محمد باعبيد';
      }
    } catch (e) {}
    return 'علوي محمد باعبيد';
  },

  // ضبط عنوان نافذة الطباعة ليظهر اسم المستخدم بجانب وقت الطباعة في ترويسة المتصفح
  setPrintTitle(docTitle) {
    const userName = this.getCurrentUserName();
    const origTitle = document.title;
    document.title = `المستخدم المسجل: ${userName} | ${docTitle || 'تقرير رسمي'} - شركة رواسي عدن`;
    const restore = () => {
      document.title = origTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 2500);
  },

  // إنشاء ترويسة التقارير الرسمية الذكية
  renderReportHeader(title, metaItems = [], cfg = null) {
    const c = cfg || this.getPrintConfig();
    const showLogo = c.show_logo === '1' || c.show_logo === 1 || c.show_logo === true;
    const accent = c.accent_color || '#d4af37';
    const userName = this.getCurrentUserName();
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });

    // التأكد من توفر اسم المستخدم والوقت بجانب بعض في بيانات الترويسة
    const items = [...metaItems];
    const hasUser = items.some(m => m.label && (m.label.includes('المستخدم') || m.label.includes('طُبع بواسطة')));
    const dateItem = items.find(m => m.label && (m.label.includes('تاريخ') || m.label.includes('الوقت') || m.label.includes('إصدار')));

    if (dateItem) {
      if (!dateItem.val.includes(timeStr) && !dateItem.val.includes(':')) {
        dateItem.label = 'تاريخ ووقت الطباعة';
        dateItem.val = `${dateItem.val} - ${timeStr}`;
      }
    } else {
      items.push({ label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` });
    }

    if (!hasUser) {
      items.push({ label: 'المستخدم المسجل بالمشروع', val: userName });
    }
    
    // تحديد قياس الشعار / الشكل بدقة
    let logoDim = 58;
    if (c.logo_size === 'small') logoDim = 42;
    else if (c.logo_size === 'large') logoDim = 76;
    else if (c.logo_size === 'xlarge') logoDim = 95;
    else if (c.logo_size === 'full') logoDim = 115;

    const renderMetaDivs = (list) => {
      return list.map(m => {
        const isUser = m.label.includes('المستخدم');
        const isTime = m.label.includes('تاريخ') || m.label.includes('الوقت');
        const badgeStyle = isUser 
          ? 'margin: 2px 0; font-size: 0.82rem; color: #0f2744; font-weight: 700; background: #f0f7ff; padding: 2px 8px; border-radius: 4px; border-right: 3px solid #1e3a5f;' 
          : (isTime 
            ? 'margin: 2px 0; font-size: 0.82rem; color: #1e293b; background: #fafaf9; padding: 1px 6px; border-radius: 4px; border-right: 3px solid ' + accent + ';'
            : 'margin: 1px 0;');
        return `<div style="${badgeStyle}">${m.label}: <strong style="color: #0f2744;">${m.val}</strong></div>`;
      }).join('');
    };

    if (c.header_style === 'plain') {
      return `
        <div class="report-header-banner" style="border-bottom-color: ${accent}; padding-bottom: 8px; margin-bottom: 12px;">
          <div class="report-header-badge-box" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
            <div class="doc-badge" style="background: #0f2744; border-right-color: ${accent}; font-size: 1.15rem; margin: 0;">
              ${title}
            </div>
            <div class="doc-info" style="text-align: left;">
              ${renderMetaDivs(items)}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="report-header-banner logo-size-${c.logo_size || 'medium'}" style="border-bottom-color: ${accent};">
        <div class="report-header-brand">
          ${showLogo ? `<img src="images/logo.png" alt="رواسي عدن" style="width: ${logoDim}px; height: ${logoDim}px; object-fit: contain;">` : ''}
          <div class="report-header-titles">
            <h2>${c.header_title || 'شركة رواسي عدن للهندسة والمقاولات'}</h2>
            <div class="en-title">${c.header_en || 'Rawasi Aden for Engineering & Contracting'}</div>
            <div class="meta-sub">
              ${c.header_subtitle || ''} 
              ${c.tax_no ? ` | <span style="font-weight: 600;">${c.tax_no}</span>` : ''}
            </div>
            ${c.slogan ? `<div style="font-size: 0.72rem; color: ${accent}; font-weight: 700; margin-top: 1px;">« ${c.slogan} »</div>` : ''}
          </div>
        </div>
        <div class="report-header-badge-box">
          <div class="doc-badge" style="border-right-color: ${accent};">
            ${title}
          </div>
          <div class="doc-info">
            ${renderMetaDivs(items)}
          </div>
        </div>
      </div>
    `;
  },

  // إنشاء صف التوقيعات والختم
  renderReportSignatures(cfg = null) {
    const c = cfg || this.getPrintConfig();
    if (c.sig_position === 'none') return '';

    const showStamp = c.show_stamp === '1' || c.show_stamp === 1 || c.show_stamp === true;

    return `
      <div class="letterhead-signatures-row">
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">${c.sig1 || 'المستلم / المحاسب'}</div>
          <div class="letterhead-sig-dots">التوقيع: ........................</div>
        </div>
        ${showStamp ? `
        <div class="letterhead-sig-col" style="min-width: 100px;">
          <div class="letterhead-stamp-circle">
            <span>الختم الرسمي</span>
          </div>
        </div>
        ` : `
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">${c.sig2 || 'المدير العام'}</div>
          <div class="letterhead-sig-dots">الاعتماد: ........................</div>
        </div>
        `}
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">${c.sig3 || 'اعتماد الإدارة'}</div>
          <div class="letterhead-sig-dots">الاعتماد: ........................</div>
        </div>
      </div>
    `;
  },

  // إنشاء تذييل التقرير والملاحظات
  renderReportFooter(cfg = null) {
    const c = cfg || this.getPrintConfig();
    const showPageNums = c.show_page_numbers === '1' || c.show_page_numbers === 1 || c.show_page_numbers === true;
    const showPrintTime = c.show_print_time === '1' || c.show_print_time === 1 || c.show_print_time === true;
    const todayDate = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = this.getCurrentUserName();

    return `
      <div style="margin-top: 14px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
        <div style="flex: 1; text-align: right;">${c.footer_notes || ''}</div>
        <div style="display: flex; gap: 14px; align-items: center; font-size: 0.7rem; color: #94a3b8;">
          ${showPrintTime ? `<span>تاريخ ووقت الطباعة: <strong>${todayDate} ${timeStr}</strong> | المستخدم المسجل: <strong style="color: #0f2744;">${userName}</strong></span>` : ''}
          ${showPageNums ? `<span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: bold; color: #475569;">وثيقة رسمية معتمدة</span>` : ''}
        </div>
      </div>
    `;
  },

  updatePrintPreview() {
    const previewBox = document.getElementById('printLivePreviewBox');
    if (!previewBox) return;

    const getVal = (id, def = '') => document.getElementById(id)?.value || def;
    const getChk = (id) => document.getElementById(id)?.checked;

    const headerTitle = getVal('printHeaderTitle', 'شركة رواسي عدن للهندسة والمقاولات');
    const headerEn = getVal('printHeaderEn', 'Rawasi Aden for Engineering & Contracting');
    const headerSub = getVal('printHeaderSubtitle', 'عدن - الجمهورية اليمنية | هاتف: 773413937');
    const taxNo = getVal('printTaxNo', 'س.ت: 102948 - ر.ض: 3004918');
    const slogan = getVal('printSlogan', 'نبني الحاضر لنستثمر المستقبل');
    const headerStyle = getVal('printHeaderStyle', 'dynamic');
    const tableDensity = getVal('printTableDensity', 'medium');
    const borderStyle = getVal('printBorderStyle', 'classic');
    const accentColor = getVal('printAccentColor', '#d4af37');
    const sigPosition = getVal('printSigPosition', 'end');
    const logoSize = getVal('printLogoSize', 'medium');
    const fontFamily = getVal('printFontFamily', 'Cairo');
    const fontSizeScale = getVal('printFontSizeScale', 'normal');
    const showLogo = getChk('printShowLogo');
    const showStamp = getChk('printShowStamp');
    const showPageNums = getChk('printShowPageNumbers');
    const showPrintTime = getChk('printShowPrintTime');
    const sig1 = getVal('printSig1', 'المستلم / المحاسب');
    const sig2 = getVal('printSig2', 'المدير العام');
    const sig3 = getVal('printSig3', 'اعتماد الإدارة');
    const footerNotes = getVal('printFooterNotes', 'تعتبر هذه السندات والوثائق رسمية ومعتمدة من الإدارة المالية');

    // خصائص السندات
    const receiptTitle = getVal('printReceiptTitle', 'سـنـد قـبـض رسـمـي');
    const expenseTitle = getVal('printExpenseTitle', 'سـنـد صـرف رسـمـي');
    const voucherLayout = getVal('printVoucherLayout', 'single_a4');
    const voucherShowTafqeet = getChk('printVoucherShowTafqeet');
    const voucherShowProject = getChk('printVoucherShowProject');
    const voucherShowPaymentMethod = getChk('printVoucherShowPaymentMethod');
    const voucherShowChequeRef = getChk('printVoucherShowChequeRef');

    // خصائص كشوفات الحسابات
    const stmtShowSummary = getChk('printStmtShowSummaryCard');
    const stmtShowRunningBal = getChk('printStmtShowRunningBalance');
    const stmtShowRef = getChk('printStmtShowReference');
    const stmtShowNotes = getChk('printStmtShowNotes');
    const stmtShowMatch = getChk('printStmtShowMatchSig');

    // خصائص المشاريع
    const projShowKpi = getChk('printProjShowKpiCards');
    const projShowExp = getChk('printProjShowExpensesTable');
    const projShowBills = getChk('printProjShowSupplierBills');
    const projShowPay = getChk('printProjShowClientPayments');
    const projShowTasks = getChk('printProjShowTasks');

    // خصائص المالية
    const finShowKpi = getChk('printFinShowKpiCards');
    const finShowExpBreak = getChk('printFinShowExpenseBreakdown');
    const finShowDualBal = getChk('printFinShowDualBalance');

    const mockCfg = {
      header_title: headerTitle,
      header_en: headerEn,
      header_subtitle: headerSub,
      tax_no: taxNo,
      slogan: slogan,
      header_style: headerStyle,
      table_density: tableDensity,
      border_style: borderStyle,
      accent_color: accentColor,
      sig_position: sigPosition,
      logo_size: logoSize,
      font_family: fontFamily,
      font_size_scale: fontSizeScale,
      show_logo: showLogo ? '1' : '0',
      show_stamp: showStamp ? '1' : '0',
      show_page_numbers: showPageNums ? '1' : '0',
      show_print_time: showPrintTime ? '1' : '0',
      sig1, sig2, sig3,
      footer_notes: footerNotes,
      receipt_title: receiptTitle,
      expense_title: expenseTitle,
      voucher_layout: voucherLayout,
      voucher_show_tafqeet: voucherShowTafqeet ? '1' : '0',
      voucher_show_project: voucherShowProject ? '1' : '0',
      voucher_show_payment_method: voucherShowPaymentMethod ? '1' : '0',
      voucher_show_cheque_ref: voucherShowChequeRef ? '1' : '0',
      stmt_show_summary_card: stmtShowSummary ? '1' : '0',
      stmt_show_running_balance: stmtShowRunningBal ? '1' : '0',
      stmt_show_reference: stmtShowRef ? '1' : '0',
      stmt_show_notes: stmtShowNotes ? '1' : '0',
      stmt_show_match_sig: stmtShowMatch ? '1' : '0',
      proj_show_kpi_cards: projShowKpi ? '1' : '0',
      proj_show_expenses_table: projShowExp ? '1' : '0',
      proj_show_supplier_bills: projShowBills ? '1' : '0',
      proj_show_client_payments: projShowPay ? '1' : '0',
      proj_show_tasks: projShowTasks ? '1' : '0',
      fin_show_kpi_cards: finShowKpi ? '1' : '0',
      fin_show_expense_breakdown: finShowExpBreak ? '1' : '0',
      fin_show_dual_balance: finShowDualBal ? '1' : '0'
    };

    const fontStyleAttr = `font-family: '${fontFamily}', sans-serif;`;
    const docType = this._previewDocType || 'receipt';
    const docCls = this.getReportDocClass(mockCfg);
    const sigHtml = this.renderReportSignatures(mockCfg);
    const footerHtml = this.renderReportFooter(mockCfg);

    // ================== 1. معاينة سند القبض ==================
    if (docType === 'receipt') {
      const headerHtml = this.renderReportHeader(receiptTitle, [
        { label: 'رقم السند', val: 'RC-2026-0008' },
        { label: 'التاريخ', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <div class="voucher-amount-card" style="padding: 8px 14px; margin: 10px 0 12px 0; border-color: ${accentColor}; background: #fdfaf2;">
            <div>
              <span style="font-size: 0.82rem; color: #475569; font-weight: bold; margin-left: 6px;">المبلغ المقبوض:</span>
              <span class="voucher-amount-value" style="font-size: 1.15rem; color: #047857;">1,500,000 ر.ي</span>
            </div>
            ${voucherShowTafqeet ? `<div class="voucher-amount-words" style="font-size: 0.78rem; color: #854d0e;">فقط: مليون وخمسمائة ألف ريال يمني لا غير.</div>` : ''}
          </div>

          <table class="voucher-grid-table" style="margin-bottom: 10px; font-size: 0.78rem;">
            <tr>
              <td class="label-cell" style="width: 28%; padding: 5px 8px; border-right-color: ${accentColor};">استلمنا من الأخ/السادة:</td>
              <td class="val-cell" style="padding: 5px 8px;">علوي محمد باعبيد</td>
            </tr>
            ${voucherShowProject ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">المشروع التابع له:</td>
              <td class="val-cell" style="padding: 5px 8px;">مشروع برج الأمل السكني</td>
            </tr>` : ''}
            ${voucherShowPaymentMethod ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">طريقة الدفع:</td>
              <td class="val-cell" style="padding: 5px 8px;">نقداً</td>
            </tr>` : ''}
            ${voucherShowChequeRef ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">رقم المرجع / الحوالة:</td>
              <td class="val-cell" style="padding: 5px 8px;">REF-99201</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">وذلك عن (البيان):</td>
              <td class="val-cell" style="padding: 5px 8px;">دفعة أعمال مقاولات وهندسة للمرحلة الأولى</td>
            </tr>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ================== 2. معاينة سند الصرف ==================
    else if (docType === 'expense') {
      const headerHtml = this.renderReportHeader(expenseTitle, [
        { label: 'رقم السند', val: 'PV-2026-0014' },
        { label: 'التاريخ', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <div class="voucher-amount-card" style="padding: 8px 14px; margin: 10px 0 12px 0; border-color: #dc2626; background: #fff5f5;">
            <div>
              <span style="font-size: 0.82rem; color: #475569; font-weight: bold; margin-left: 6px;">المبلغ المصروف:</span>
              <span class="voucher-amount-value" style="font-size: 1.15rem; color: #dc2626;">850,000 ر.ي</span>
            </div>
            ${voucherShowTafqeet ? `<div class="voucher-amount-words" style="font-size: 0.78rem; color: #991b1b;">فقط: ثمانمائة وخمسون ألف ريال يمني لا غير.</div>` : ''}
          </div>

          <table class="voucher-grid-table" style="margin-bottom: 10px; font-size: 0.78rem;">
            <tr>
              <td class="label-cell" style="width: 28%; padding: 5px 8px; border-right-color: #dc2626;">صرفنا إلى الأخ/السادة:</td>
              <td class="val-cell" style="padding: 5px 8px;">شركة الحديد والصلب للتجارة</td>
            </tr>
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">نوع المصروف / البند:</td>
              <td class="val-cell" style="padding: 5px 8px;">توريد مواد بناء وتسليح</td>
            </tr>
            ${voucherShowProject ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">المشروع التابع له:</td>
              <td class="val-cell" style="padding: 5px 8px;">مشروع برج الأمل السكني</td>
            </tr>` : ''}
            ${voucherShowPaymentMethod ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">طريقة الدفع:</td>
              <td class="val-cell" style="padding: 5px 8px;">شيك بنكي (بنك القطيبي)</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">وذلك عن (البيان):</td>
              <td class="val-cell" style="padding: 5px 8px;">شراء حديد تسليح مقاس 16 ملم للمبنى</td>
            </tr>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ================== 3. معاينة كشف حساب عميل ==================
    else if (docType === 'client_stmt') {
      const headerHtml = this.renderReportHeader('كشف حساب عميل تفصيلي', [
        { label: 'اسم العميل', val: 'علوي محمد باعبيد' },
        { label: 'الفترة', val: 'من 2026-01-01 إلى اليوم' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          ${stmtShowSummary ? `
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; text-align: center; background: #f8fafc;">
              <div style="font-size: 0.7rem; color: #64748b;">إجمالي المسحوب (مدين)</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #0f2744;">5,000,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #86efac; border-radius: 4px; padding: 6px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.7rem; color: #15803d;">إجمالي المسدد (دائن)</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #15803d;">3,500,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 4px; padding: 6px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.7rem; color: #b91c1c;">الرصيد المتبقي عليه</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #b91c1c;">1,500,000 ر.ي</div>
            </div>
          </div>` : ''}

          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead>
              <tr>
                <th>التاريخ</th>
                ${stmtShowRef ? `<th>رقم السند</th>` : ''}
                ${stmtShowNotes ? `<th>البيان والتفاصيل</th>` : ''}
                <th>مدين (عله)</th>
                <th>دائن (له)</th>
                ${stmtShowRunningBal ? `<th>الرصيد التراكمي</th>` : ''}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-01-15</td>
                ${stmtShowRef ? `<td>CNT-01</td>` : ''}
                ${stmtShowNotes ? `<td>مستخلص أعمال صب خرسانة الدور الأول</td>` : ''}
                <td style="color: #0f2744;">3,000,000</td>
                <td>0</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">3,000,000</td>` : ''}
              </tr>
              <tr>
                <td>2026-02-01</td>
                ${stmtShowRef ? `<td>RC-101</td>` : ''}
                ${stmtShowNotes ? `<td>دفعة نقدية مسددة في الصندوق</td>` : ''}
                <td>0</td>
                <td style="color: #059669;">2,000,000</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">1,000,000</td>` : ''}
              </tr>
              <tr>
                <td>2026-03-10</td>
                ${stmtShowRef ? `<td>CNT-02</td>` : ''}
                ${stmtShowNotes ? `<td>مستخلص تشطيبات وبناء الدور الثاني</td>` : ''}
                <td style="color: #0f2744;">2,000,000</td>
                <td>0</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">3,000,000</td>` : ''}
              </tr>
              <tr>
                <td>2026-04-05</td>
                ${stmtShowRef ? `<td>RC-105</td>` : ''}
                ${stmtShowNotes ? `<td>سداد بحوالة بنكية</td>` : ''}
                <td>0</td>
                <td style="color: #059669;">1,500,000</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">1,500,000</td>` : ''}
              </tr>
            </tbody>
          </table>

          ${stmtShowMatch ? `
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 6px 10px; font-size: 0.72rem; color: #475569; display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
            <span>أقر أنا العميل المذكور أعلاه بصحة الرصيد الموضح وقدره (1,500,000 ر.ي):</span>
            <span>توقيع العميل: ..........................</span>
          </div>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ================== 4. معاينة كشف حساب مورد ==================
    else if (docType === 'supplier_stmt') {
      const headerHtml = this.renderReportHeader('كشف حساب مورد تفصيلي', [
        { label: 'اسم المورد', val: 'شركة الحديد والصلب للتجارة' },
        { label: 'تاريخ التقرير', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>رقم الفاتورة/السند</th>
                <th>البيان والمشتريات</th>
                <th>مستحق له (دائن)</th>
                <th>المدفوع له (مدين)</th>
                <th>الرصيد المتبقي</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-02-10</td>
                <td>INV-301</td>
                <td>توريد 15 طن حديد تسليح تركي</td>
                <td style="color: #dc2626;">4,500,000</td>
                <td>0</td>
                <td style="font-weight: bold; color: #dc2626;">4,500,000</td>
              </tr>
              <tr>
                <td>2026-02-25</td>
                <td>PV-201</td>
                <td>دفعة سند صرف نقدي للمورد</td>
                <td>0</td>
                <td style="color: #059669;">3,000,000</td>
                <td style="font-weight: bold; color: #dc2626;">1,500,000</td>
              </tr>
            </tbody>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ================== 5. معاينة تقرير المشروع الشامل ==================
    else if (docType === 'project') {
      const headerHtml = this.renderReportHeader('تقرير الحساب المالي للمشروع', [
        { label: 'كود المشروع', val: 'PRJ-2026-01' },
        { label: 'اسم المشروع', val: 'برج الأمل السكني' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          ${projShowKpi ? `
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px;">
            <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #64748b;">قيمة العقد</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #0f2744;">25,000,000</div>
            </div>
            <div style="background: #fef2f2; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #b91c1c;">التكلفة الفعلية</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #b91c1c;">12,400,000</div>
            </div>
            <div style="background: #f0fdf4; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #15803d;">المسدد من العميل</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #15803d;">15,000,000</div>
            </div>
            <div style="background: #fdfaf2; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid #d4af37;">
              <div style="font-size: 0.68rem; color: #b8911c;">نسبة الإنجاز</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #047857;">65%</div>
            </div>
          </div>` : ''}

          ${projShowExp ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid ${accentColor}; padding-right: 4px;">المصروفات المباشرة للمشروع:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead>
              <tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>طريقة الدفع</th></tr>
            </thead>
            <tbody>
              <tr><td>2026-02-01</td><td>حفريات وتجهيز موقع</td><td>1,500,000</td><td>نقدي</td></tr>
              <tr><td>2026-03-10</td><td>صب القواعد والأساسات</td><td>4,800,000</td><td>تحويل</td></tr>
            </tbody>
          </table>` : ''}

          ${projShowBills ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #3b82f6; padding-right: 4px;">فواتير وتوريدات الموردين:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead>
              <tr><th>التاريخ</th><th>المورد</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr>
            </thead>
            <tbody>
              <tr><td>2026-02-20</td><td>شركة الأسمنت</td><td>إسمنت بورتلاندي</td><td>3,200,000</td><td>مسدد بالكامل</td></tr>
              <tr><td>2026-03-15</td><td>مؤسسة الحديد</td><td>حديد تسليح 16 ملم</td><td>2,900,000</td><td>مسدد جزئياً</td></tr>
            </tbody>
          </table>` : ''}

          ${projShowPay ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #059669; padding-right: 4px;">مقبوضات ودفعات العميل:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead>
              <tr><th>التاريخ</th><th>رقم السند</th><th>المبلغ المقبوض</th><th>البيان</th></tr>
            </thead>
            <tbody>
              <tr><td>2026-01-20</td><td>RC-101</td><td>5,000,000</td><td>دفعة مقدمة عند توقيع العقد</td></tr>
              <tr><td>2026-03-01</td><td>RC-105</td><td>10,000,000</td><td>مستخلص إنجاز الأساسات</td></tr>
            </tbody>
          </table>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ================== 6. معاينة الأرباح والخسائر ==================
    else if (docType === 'profit_loss') {
      const headerHtml = this.renderReportHeader('تقرير الأرباح والخسائر (قائمة الدخل)', [
        { label: 'الفترة المالية', val: '2026-01-01 إلى 2026-09-08' },
        { label: 'الحالة', val: 'معتمد رسمياً' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          ${finShowKpi ? `
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            <div style="border: 1px solid #86efac; border-radius: 4px; padding: 8px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.7rem; color: #15803d;">إجمالي الإيرادات</div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #15803d;">35,000,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 4px; padding: 8px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.7rem; color: #b91c1c;">إجمالي المصروفات</div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #b91c1c;">22,500,000 ر.ي</div>
            </div>
            <div style="border: 1.5px solid #d4af37; border-radius: 4px; padding: 8px; text-align: center; background: #fdfaf2;">
              <div style="font-size: 0.7rem; color: #b8911c;">صافي الأرباح التشغيلية</div>
              <div style="font-weight: 800; font-size: 1.15rem; color: #047857;">12,500,000 ر.ي</div>
            </div>
          </div>` : ''}

          ${finShowExpBreak ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid ${accentColor}; padding-right: 4px;">توزيع بنود المصروفات ونسبتها:</div>
          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead>
              <tr><th>بند المصروف</th><th>المبلغ</th><th>النسبة من الإجمالي</th></tr>
            </thead>
            <tbody>
              <tr><td>مواد بناء وتوريدات خرسانة وحديد</td><td>14,500,000 ر.ي</td><td>64.4%</td></tr>
              <tr><td>أجور عمالة ومهندسين ومقاولين باطن</td><td>5,500,000 ر.ي</td><td>24.4%</td></tr>
              <tr><td>مصروفات تشغيلية ومحروقات ونقليات</td><td>2,500,000 ر.ي</td><td>11.2%</td></tr>
            </tbody>
          </table>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ================== 7. معاينة الميزانية العمومية ==================
    else if (docType === 'balance_sheet') {
      const headerHtml = this.renderReportHeader('تقرير الميزانية العمومية والمركز المالي', [
        { label: 'تاريخ الميزانية', val: '2026-09-08' },
        { label: 'النوع', val: 'مركز مالي ختامي' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin-bottom: 4px; border-right: 3px solid #059669; padding-right: 4px;">الأصول والموجودات (Assets)</div>
              <table class="official-report-table" style="font-size: 0.72rem;">
                <tbody>
                  <tr><td>نقدية بالصندوق والبنوك</td><td style="font-weight: bold;">8,500,000</td></tr>
                  <tr><td>مستحقات على العملاء</td><td style="font-weight: bold;">12,000,000</td></tr>
                  <tr><td>أصول ثابتة ومعدات</td><td style="font-weight: bold;">15,000,000</td></tr>
                  <tr style="background: #f0fdf4; font-weight: bold;"><td>إجمالي الأصول:</td><td style="color: #047857;">35,500,000 ر.ي</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin-bottom: 4px; border-right: 3px solid #dc2626; padding-right: 4px;">الالتزامات وحقوق الملكية</div>
              <table class="official-report-table" style="font-size: 0.72rem;">
                <tbody>
                  <tr><td>مستحقات للموردين</td><td style="font-weight: bold;">5,500,000</td></tr>
                  <tr><td>أرباح مرحلة ودورات سابقة</td><td style="font-weight: bold;">10,000,000</td></tr>
                  <tr><td>رأس المال وحقوق الملكية</td><td style="font-weight: bold;">20,000,000</td></tr>
                  <tr style="background: #fef2f2; font-weight: bold;"><td>إجمالي الالتزامات والملكية:</td><td style="color: #b91c1c;">35,500,000 ر.ي</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }
  },

  // ================== إدارة المستخدمين والصلاحيات ==================
  async loadUsers() {
    try {
      const res = await fetch('/api/users');
      const json = await res.json();
      if (json.success) {
        this._cachedUsers = json.data || [];
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        if (this._cachedUsers.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا يوجد مستخدمون مسجلون حالياً</td></tr>`;
          return;
        }

        tbody.innerHTML = this._cachedUsers.map(u => {
          // Role badge class
          let roleBadgeClass = 'badge-role-accountant';
          let roleTitle = u.role_name || u.role;
          if (u.role === 'admin') {
            roleBadgeClass = 'badge-role-admin';
            roleTitle = 'المدير العام';
          } else if (u.role === 'accountant') {
            roleBadgeClass = 'badge-role-accountant';
            roleTitle = 'المحاسب المالي';
          } else if (u.role === 'auditor') {
            roleBadgeClass = 'badge-warning';
            roleTitle = 'المراجع المالي (مدقق)';
          } else if (u.role === 'project_manager') {
            roleBadgeClass = 'badge-role-pm';
            roleTitle = 'مهندس المشاريع';
          } else if (u.role === 'storekeeper') {
            roleBadgeClass = 'badge-role-storekeeper';
            roleTitle = 'أمين المخزن';
          }

          // Permissions summary
          const perms = u.permissions_list || [];
          let permsHtml = '';
          if (u.role === 'admin' || perms.includes('all') || perms.length >= 25) {
            permsHtml = `<span class="badge badge-role-admin">كافة الصلاحيات (شامل)</span>`;
          } else if (perms.length === 0) {
            permsHtml = `<span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-secondary);">صلاحيات افتراضية (${roleTitle})</span>`;
          } else {
            permsHtml = `<span class="badge badge-active" title="${perms.join(', ')}">${perms.length} صلاحية مخصصة</span>`;
          }

          // Scope summary
          let scopeHtml = '';
          const scopeParts = [];
          if (u.branch) scopeParts.push(`🏢 ${u.branch}`);
          if (u.department) scopeParts.push(`📑 ${u.department}`);
          if (u.allowed_projects && u.allowed_projects !== 'all' && u.allowed_projects !== '*' && u.allowed_projects !== '[]') {
            scopeParts.push(`🏗️ مشاريع محددة`);
          }
          if (scopeParts.length > 0) {
            scopeHtml = `<div style="font-size: 0.72rem; color: #38bdf8; margin-top: 3px; font-weight: 600;">${scopeParts.join(' | ')}</div>`;
          }

          // User security & session badge
          const uSec = u.security_settings;
          let secBadgeHtml = '';
          if (uSec && typeof uSec === 'object') {
            const isLock = uSec.session_overflow_action === 'lock_device' || uSec.overflowAction === 'lock_device';
            const isSingle = uSec.session_mode === 'single' || isLock;
            const devLimit = uSec.session_device_limit || 1;
            const exp = uSec.jwt_token_expiry || '8h';
            const label = isLock ? `جهاز معتمد واحد (${exp})` : (isSingle ? `جلسة واحدة (${exp})` : `متعددة (${devLimit}) (${exp})`);
            const icon = isLock ? '🔒' : '🛡️';
            secBadgeHtml = `<div style="margin-top: 5px;"><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.72rem; cursor: pointer;" onclick="Auth.openSecuritySessionsModal(${u.id})" title="إعدادات أمان مخصصة لهذا المستخدم - انقر للتعديل">${icon} ${label} ⭐</span></div>`;
          } else {
            const isLock = Auth.securitySettings?.session_overflow_action === 'lock_device';
            const isSingle = Auth.securitySettings?.session_mode === 'single' || isLock;
            const devLimit = Auth.securitySettings?.session_device_limit || 3;
            const exp = Auth.securitySettings?.jwt_token_expiry || '8h';
            const label = isLock ? `جهاز معتمد واحد (${exp})` : (isSingle ? `جلسة واحدة (${exp})` : `متعددة (${devLimit}) (${exp})`);
            secBadgeHtml = `<div style="margin-top: 5px;"><span class="badge" style="background: rgba(148, 163, 184, 0.08); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); font-size: 0.72rem; cursor: pointer;" onclick="Auth.openSecuritySessionsModal(${u.id})" title="يرث الإعدادات العامة للنظام - انقر لتخصيص هذا المستخدم">⚙️ عام: ${label}</span></div>`;
          }

          // 2FA PIN Badge
          let tfaBadgeHtml = '';
          const has2Fa = (u.two_factor_enabled !== 0 && u.two_factor_enabled !== false);
          if (u.role === 'admin' || u.username === 'admin' || has2Fa) {
            const currentPin = u.two_factor_pin || '123456';
            tfaBadgeHtml = `<div style="margin-top: 5px;">
              <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light); border: 1px solid rgba(212, 175, 55, 0.4); font-size: 0.72rem; cursor: pointer;" onclick="Settings.openEditUserModal(${u.id}, true)" title="رمز التحقق بخطوتين (PIN) المعتمد لهذا الحساب - انقر للتعديل وتغيير الرمز">
                🔐 PIN: <strong style="font-family: monospace; letter-spacing: 1px; color: #fbbf24;">${currentPin}</strong>
              </span>
            </div>`;
          }

          // Status Badge & Live Connection Indicator
          const isActive = u.status === 'active';
          const statusBadge = isActive
            ? `<span class="badge-status-active">نشط</span>`
            : `<span class="badge-status-inactive">معطل</span>`;

          const isOnline = !!u.is_currently_online;
          const onlineBadge = isOnline
            ? `<div style="margin-top: 4px;"><span class="badge" style="background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.72rem; padding: 2px 8px;"><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981; margin-left:4px; box-shadow: 0 0 6px #10b981;"></span>متصل الآن 🟢</span></div>`
            : `<div style="margin-top: 4px;"><span class="badge" style="background: rgba(148, 163, 184, 0.08); color: #94a3b8; font-size: 0.72rem; padding: 2px 8px;">غير متصل ⚪</span></div>`;

          const isRootAdmin = u.username === 'admin' || u.id === 1;
          const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';

          return `
            <tr>
              <td>
                <div style="font-weight: 700; color: var(--gold-light); font-size: 0.9rem;">${u.username}</div>
                <div style="font-size: 0.72rem; color: var(--text-secondary);">ID: #${u.id}</div>
              </td>
              <td><strong>${u.full_name}</strong></td>
              <td><span class="badge ${roleBadgeClass}">${roleTitle}</span></td>
              <td>
                <div style="font-size: 0.82rem;">${u.phone || '-'}</div>
                ${u.email ? `<div style="font-size: 0.72rem; color: var(--text-secondary);">${u.email}</div>` : ''}
              </td>
              <td>
                ${permsHtml}
                ${scopeHtml}
                ${secBadgeHtml}
                ${tfaBadgeHtml}
              </td>
              <td>
                ${statusBadge}
                ${onlineBadge}
              </td>
              <td>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.openEditUserModal(${u.id})" title="تعديل المستخدم والصلاحيات">
                    ✏️ تعديل
                  </button>
                  ${isCurrentUserAdmin ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: #10b981; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); font-weight: 600;" onclick="Auth.openSecuritySessionsModal(${u.id})" title="تخصيص سياسة الأمان والجلسات لهذا المستخدم">
                      🛡️ أمان وجلسات
                    </button>
                  ` : ''}
                  ${isOnline ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: #fbbf24; border-color: rgba(245,158,11,0.4);" onclick="Settings.disconnectUser(${u.id}, '${u.full_name || u.username}')" title="إنهاء الجلسة وفصل المستخدم عن النظام لمنع التكرار">
                      🔌 فصل
                    </button>
                  ` : ''}
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.toggleUserStatus(${u.id})" title="${isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}" ${isRootAdmin ? 'disabled style="opacity:0.4;"' : ''}>
                    ${isActive ? '⏸️ تعطيل' : '▶️ تنشيط'}
                  </button>
                  ${!isRootAdmin ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: var(--accent-red); border-color: rgba(239,68,68,0.3);" onclick="Settings.deleteUser(${u.id}, '${u.username}')" title="حذف المستخدم">
                      🗑️
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Error loading users:', e);
    }
  },

  // ================== إدارة نطاق الصلاحيات (المشاريع، الفروع، الأقسام) ==================
  async fetchScopesMeta() {
    if (this._scopesMeta) return this._scopesMeta;
    try {
      const res = await fetch('/api/users/scopes-meta', {
        headers: Auth.token ? { 'Authorization': `Bearer ${Auth.token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        this._scopesMeta = data;
        return data;
      }
    } catch (e) {
      console.error('Error fetching scopes meta:', e);
    }
    return null;
  },

  async renderScopesControls(user = null) {
    const meta = await this.fetchScopesMeta();
    const branchSelect = document.getElementById('userBranchVal');
    const deptSelect = document.getElementById('userDepartmentVal');
    const projectsList = document.getElementById('userProjectsCheckList');
    const allProjChk = document.getElementById('userAllProjectsScopeChk');
    const projContainer = document.getElementById('userProjectsScopeContainer');

    if (branchSelect) {
      const currentBranchId = user ? (user.branch_id || '') : '';
      branchSelect.innerHTML = `<option value="">كافة الفروع (غير مقيد)</option>` +
        (meta?.branches || []).map(b => `<option value="${b.id}" ${String(b.id) === String(currentBranchId) ? 'selected' : ''}>🏢 ${b.name} (${b.city || ''})</option>`).join('');
    }

    if (deptSelect) {
      const currentDeptId = user ? (user.department_id || '') : '';
      deptSelect.innerHTML = `<option value="">كافة الأقسام (غير مقيد)</option>` +
        (meta?.departments || []).map(d => `<option value="${d.id}" ${String(d.id) === String(currentDeptId) ? 'selected' : ''}>📑 ${d.name}</option>`).join('');
    }

    if (projectsList) {
      let allowedProjIds = [];
      if (user && user.allowed_projects) {
        try {
          allowedProjIds = typeof user.allowed_projects === 'string' && (user.allowed_projects.startsWith('[') || user.allowed_projects.startsWith('{'))
            ? JSON.parse(user.allowed_projects)
            : String(user.allowed_projects).split(',').map(s => s.trim());
        } catch (e) {
          allowedProjIds = [String(user.allowed_projects)];
        }
      }

      const isAll = !user || allowedProjIds.length === 0 || allowedProjIds.includes('*') || allowedProjIds.includes('all');
      if (allProjChk) allProjChk.checked = isAll;
      if (projContainer) projContainer.style.display = isAll ? 'none' : 'block';

      projectsList.innerHTML = (meta?.projects || []).map(p => {
        const checked = !isAll && allowedProjIds.some(id => String(id) === String(p.id));
        return `
          <label style="display: flex; align-items: center; gap: 6px; font-size: 0.76rem; color: #f1f5f9; cursor: pointer; background: rgba(255,255,255,0.04); padding: 4px 8px; border-radius: 4px;">
            <input type="checkbox" class="user-proj-scope-chk" value="${p.id}" ${checked ? 'checked' : ''} style="accent-color: #38bdf8;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</span>
          </label>
        `;
      }).join('');
    }
  },

  onAllProjectsScopeToggle(isAll) {
    const projContainer = document.getElementById('userProjectsScopeContainer');
    if (projContainer) {
      projContainer.style.display = isAll ? 'none' : 'block';
    }
    if (isAll) {
      document.querySelectorAll('.user-proj-scope-chk').forEach(c => c.checked = false);
    }
  },

  // ================== نافذة إضافة مستخدم جديد ==================
  async openNewUserModal() {
    const titleEl = document.getElementById('userModalTitle');
    if (titleEl) titleEl.textContent = 'إضافة مستخدم جديد وتحديد الصلاحيات';

    document.getElementById('userIdVal').value = '';
    document.getElementById('userNameVal').value = '';
    document.getElementById('userUsernameVal').value = '';
    
    const pwdInput = document.getElementById('userPasswordVal');
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.required = true;
      pwdInput.placeholder = 'كلمة المرور (8 خانات على الأقل)';
    }
    if (typeof Auth !== 'undefined' && Auth.checkPasswordStrength) {
      Auth.checkPasswordStrength('', 'userPasswordStrengthBox');
    }

    const pwdHint = document.getElementById('userPasswordHint');
    if (pwdHint) pwdHint.style.display = 'none';

    document.getElementById('userPhoneVal').value = '';
    document.getElementById('userEmailVal').value = '';
    document.getElementById('userStatusVal').value = 'active';

    const roleSelect = document.getElementById('userRoleVal');
    if (roleSelect) {
      roleSelect.value = 'accountant';
      this.applyRolePermissionsPreset('accountant');
    }

    // تجهيز نطاق الصلاحيات الجغرافي والإداري (فروع، أقسام، مشاريع)
    await this.renderScopesControls(null);

    // تجهيز بطاقة الأمان والجلسات المخصصة (المكان الأخضر)
    const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';
    const secCard = document.getElementById('userModalSecurityCard');
    if (secCard) {
      secCard.style.display = isCurrentUserAdmin ? 'block' : 'none';
    }
    this.populateUserSecurityCard(null);

    // ضبط حقل رمز التحقق 2FA الافتراضي وحالته
    const pinInput = document.getElementById('user2FaPinVal');
    if (pinInput) {
      pinInput.value = '123456';
      pinInput.type = 'password';
    }
    const tfaEnabledChk = document.getElementById('user2FaEnabledVal');
    if (tfaEnabledChk) tfaEnabledChk.checked = true;
    const eyeIcon = document.getElementById('user2FaEyeIcon');
    if (eyeIcon) eyeIcon.textContent = '👁️';

    App.openModal('newUserModal');
  },

  // ================== نافذة تعديل مستخدم ==================
  async openEditUserModal(userId, focus2Fa = false) {
    const user = this._cachedUsers.find(u => u.id === userId);
    if (!user) {
      App.showToast('لم يتم العثور على بيانات المستخدم', 'error');
      return;
    }

    const titleEl = document.getElementById('userModalTitle');
    if (titleEl) titleEl.textContent = `تعديل بيانات وصلاحيات المستخدم (${user.full_name})`;

    document.getElementById('userIdVal').value = user.id;
    document.getElementById('userNameVal').value = user.full_name || '';
    document.getElementById('userUsernameVal').value = user.username || '';

    const pwdInput = document.getElementById('userPasswordVal');
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.required = false;
      pwdInput.placeholder = 'اتركه فارغاً للاحتفاظ بكلمة المرور الحالية';
    }
    if (typeof Auth !== 'undefined' && Auth.checkPasswordStrength) {
      Auth.checkPasswordStrength('', 'userPasswordStrengthBox');
    }

    const pwdHint = document.getElementById('userPasswordHint');
    if (pwdHint) pwdHint.style.display = 'block';

    document.getElementById('userPhoneVal').value = user.phone || '';
    document.getElementById('userEmailVal').value = user.email || '';
    document.getElementById('userStatusVal').value = user.status || 'active';

    const roleSelect = document.getElementById('userRoleVal');
    if (roleSelect) {
      roleSelect.value = user.role || 'custom';
    }

    // تجهيز نطاق الصلاحيات الجغرافي والإداري لهذا المستخدم
    await this.renderScopesControls(user);

    // تعبئة حقل رمز التحقق بخطوتين (2FA PIN) وحالته للمستخدم الحالي
    const editPinInput = document.getElementById('user2FaPinVal');
    if (editPinInput) {
      editPinInput.value = user.two_factor_pin || (user.role === 'admin' || user.username === 'admin' ? '123456' : '123456');
      editPinInput.type = 'password';
    }
    const editTfaEnabledChk = document.getElementById('user2FaEnabledVal');
    if (editTfaEnabledChk) {
      editTfaEnabledChk.checked = (user.two_factor_enabled !== undefined && user.two_factor_enabled !== null)
        ? (user.two_factor_enabled !== 0 && user.two_factor_enabled !== false)
        : true;
    }
    const editEyeIcon = document.getElementById('user2FaEyeIcon');
    if (editEyeIcon) editEyeIcon.textContent = '👁️';

    // تجهيز بطاقة الأمان والجلسات للمستخدم داخل نافذة التعديل (المكان الأخضر)
    const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';
    const secCard = document.getElementById('userModalSecurityCard');
    if (secCard) {
      secCard.style.display = isCurrentUserAdmin ? 'block' : 'none';
    }
    this.populateUserSecurityCard(user.security_settings);

    // Uncheck all checkboxes first
    this.selectAllPermissions(false);

    // Check user's assigned permissions
    const perms = user.permissions_list || [];
    if (user.username === 'admin' || perms.includes('all')) {
      this.selectAllPermissions(true);
    } else if (perms.length > 0) {
      perms.forEach(p => {
        const chk = document.querySelector(`.perm-chk[value="${p}"]`);
        if (chk) chk.checked = true;
      });
      // إذا كانت الصلاحيات مخصصة، نظهر الدور كـ "مخصص" في القائمة
      const totalCheckboxes = document.querySelectorAll('.perm-chk').length;
      if (roleSelect && perms.length < totalCheckboxes) {
        roleSelect.value = 'custom';
      }
    } else if (user.role === 'admin') {
      this.selectAllPermissions(true);
    } else {
      // If no custom perms, apply role default
      this.applyRolePermissionsPreset(user.role || 'accountant');
    }

    App.openModal('newUserModal');

    if (focus2Fa) {
      setTimeout(() => {
        const card = document.getElementById('user2FaCardContainer');
        const pinInput = document.getElementById('user2FaPinVal');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.transition = 'box-shadow 0.4s ease, border-color 0.4s ease';
          card.style.borderColor = 'var(--gold-primary)';
          card.style.boxShadow = '0 0 16px rgba(212, 175, 55, 0.4)';
          setTimeout(() => {
            card.style.boxShadow = '';
            card.style.borderColor = 'rgba(212, 175, 55, 0.35)';
          }, 1500);
        }
        if (pinInput) {
          pinInput.focus();
          pinInput.select();
        }
      }, 350);
    }
  },

  // ================== دوال التحكم برمز التحقق بخطوتين (2FA PIN) ==================
  toggle2FaPinVisibility() {
    const pinInput = document.getElementById('user2FaPinVal');
    const eyeIcon = document.getElementById('user2FaEyeIcon');
    if (!pinInput) return;
    if (pinInput.type === 'password') {
      pinInput.type = 'text';
      if (eyeIcon) eyeIcon.textContent = '🙈';
    } else {
      pinInput.type = 'password';
      if (eyeIcon) eyeIcon.textContent = '👁️';
    }
  },

  generateRandom2FaPin() {
    const pinInput = document.getElementById('user2FaPinVal');
    if (!pinInput) return;
    const randomPin = String(Math.floor(100000 + Math.random() * 900000));
    pinInput.value = randomPin;
    pinInput.type = 'text';
    const eyeIcon = document.getElementById('user2FaEyeIcon');
    if (eyeIcon) eyeIcon.textContent = '🙈';
    App.showToast(`تم توليد رمز أمان جديد: ${randomPin} 🎲 - يرجى حفظ التعديلات للاعتماد`, 'info');
  },

  resetDefault2FaPin() {
    const pinInput = document.getElementById('user2FaPinVal');
    if (!pinInput) return;
    pinInput.value = '123456';
    App.showToast('تمت إعادة تعيين الرمز للافتراضي: 123456', 'info');
  },

  // تعبئة وضبط خيارات الأمان والجلسات في البطاقة الخضراء
  populateUserSecurityCard(secSettings) {
    const policySelect = document.getElementById('userSecPolicyType');
    const limitSelect = document.getElementById('userSecDeviceLimit');
    const overflowSelect = document.getElementById('userSecOverflowAction');
    const tokenExpSelect = document.getElementById('userSecTokenExpiry');
    const startInput = document.getElementById('userSecStartTime');
    const endInput = document.getElementById('userSecEndTime');

    let sec = secSettings;
    if (typeof sec === 'string') {
      try { sec = JSON.parse(sec); } catch (e) { sec = null; }
    }

    const isLockDevice = (sec?.session_overflow_action === 'lock_device' || sec?.overflowAction === 'lock_device');

    if (sec && (sec.sessionMode === 'strict_single' || sec.sessionMode === 'multi_device' || isLockDevice)) {
      if (policySelect) {
        if (isLockDevice) {
          policySelect.value = 'lock_device';
        } else {
          policySelect.value = sec.sessionMode;
        }
      }
      if (limitSelect) limitSelect.value = String(sec.maxSessions || sec.session_device_limit || 3);
      if (overflowSelect) overflowSelect.value = sec.overflowAction || sec.session_overflow_action || (isLockDevice ? 'lock_device' : 'kick_oldest');
      if (tokenExpSelect) {
        if (sec.jwt_token_expiry === 'custom' || sec.tokenExpiryPreset === 'custom' || sec.work_hours_enabled) {
          tokenExpSelect.value = 'custom';
        } else if (sec.tokenExpiryPreset) {
          tokenExpSelect.value = sec.tokenExpiryPreset;
        } else if (sec.tokenExpiryHours) {
          tokenExpSelect.value = sec.tokenExpiryHours + 'h';
        } else {
          tokenExpSelect.value = '8h';
        }
      }
      if (startInput) startInput.value = sec.work_start_time || '08:00';
      if (endInput) endInput.value = sec.work_end_time || '16:00';
    } else {
      if (policySelect) policySelect.value = 'inherit';
      if (limitSelect) limitSelect.value = '3';
      if (overflowSelect) overflowSelect.value = 'kick_oldest';
      if (tokenExpSelect) tokenExpSelect.value = '8h';
      if (startInput) startInput.value = '08:00';
      if (endInput) endInput.value = '16:00';
    }

    // شريط الجهاز المعتمد
    const boundBox = document.getElementById('userSecBoundDeviceBox');
    const boundText = document.getElementById('userSecBoundDeviceText');
    const boundResetBtn = document.getElementById('btnUserSecResetBoundDevice');
    if (boundBox) {
      if (isLockDevice || sec?.authorized_device_id) {
        boundBox.style.display = 'flex';
        if (sec?.authorized_device_id) {
          boundText.innerHTML = `📱 <strong>الجهاز المعتمد:</strong> <span style="color:#38bdf8;">${sec.authorized_device_name || 'جهاز مسجل'}</span>`;
          if (boundResetBtn) boundResetBtn.style.display = 'inline-block';
        } else {
          boundText.innerHTML = `📱 <strong>الجهاز المعتمد:</strong> <span style="color:#94a3b8;">لم يسجل بعد (سيتم قفل أول جهاز).</span>`;
          if (boundResetBtn) boundResetBtn.style.display = 'none';
        }
      } else {
        boundBox.style.display = 'none';
      }
    }

    this.onUserSecurityPolicyChange();
    this.onWorkHoursChange();
  },

  // عند تغيير خيار سياسة الأمان داخل نافذة المستخدم
  onUserSecurityPolicyChange() {
    const policyType = document.getElementById('userSecPolicyType')?.value || 'inherit';
    const multiBox = document.getElementById('userSecMultiControls');
    const tokenBox = document.getElementById('userSecTokenBox');
    const badge = document.getElementById('userSecBadgeType');
    const note = document.getElementById('userSecHelpNote');
    const boundBox = document.getElementById('userSecBoundDeviceBox');
    const overflowSelect = document.getElementById('userSecOverflowAction');

    if (policyType === 'lock_device') {
      if (multiBox) multiBox.style.display = 'none';
      if (tokenBox) tokenBox.style.display = 'block';
      if (boundBox) boundBox.style.display = 'flex';
      if (overflowSelect) overflowSelect.value = 'lock_device';
      if (badge) {
        badge.textContent = 'منع أي جهاز جديد 🛡️';
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#10b981';
      }
      if (note) {
        note.innerHTML = '🛡️ <strong>قفل على جهاز واحد:</strong> يُسمح للمستخدم بالدخول من جهاز واحد فقط معتمد، ويمنع النظام تماماً الدخول من أي جهاز آخر جديد.';
      }
    } else if (policyType === 'strict_single') {
      if (multiBox) multiBox.style.display = 'none';
      if (tokenBox) tokenBox.style.display = 'block';
      if (boundBox) boundBox.style.display = 'none';
      if (overflowSelect && overflowSelect.value === 'lock_device') overflowSelect.value = 'kick_oldest';
      if (badge) {
        badge.textContent = 'جلسة واحدة (مخصص)';
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = '#f87171';
      }
      if (note) {
        note.innerHTML = '🔒 <strong>جلسة واحدة صارمة:</strong> يُسمح بتسجيل الدخول من جهاز واحد فقط، وسيتم تطبيق الإجراء المختار فوراً.';
      }
    } else if (policyType === 'multi_device') {
      if (multiBox) multiBox.style.display = 'block';
      if (tokenBox) tokenBox.style.display = 'block';
      if (boundBox) boundBox.style.display = 'none';
      if (overflowSelect && overflowSelect.value === 'lock_device') overflowSelect.value = 'kick_oldest';
      if (badge) {
        badge.textContent = 'متعدد الأجهزة (مخصص)';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.color = '#34d399';
      }
      if (note) {
        note.innerHTML = '📱💻 <strong>أجهزة متعددة:</strong> يُسمح بفتح الحساب من عدة أجهزة في نفس الوقت حتى السقف المحدد.';
      }
    } else {
      // inherit
      if (multiBox) multiBox.style.display = 'none';
      if (tokenBox) tokenBox.style.display = 'none';
      if (boundBox) boundBox.style.display = 'none';
      if (badge) {
        badge.textContent = 'افتراضي النظام';
        badge.style.background = 'rgba(212, 175, 55, 0.15)';
        badge.style.color = 'var(--gold-light)';
      }
      if (note) {
        note.innerHTML = '⚙️ <strong>وراثة الافتراضي:</strong> يتبع المستخدم إعدادات الأمان والجلسات العامة المعتمدة في النظام.';
      }
    }

    this.onWorkHoursChange();
  },

  // عند تغيير خيار فترة وساعات العمل المخصصة
  onWorkHoursChange() {
    const tokenExpSelect = document.getElementById('userSecTokenExpiry');
    const workHoursBox = document.getElementById('userSecWorkHoursBox');
    const startInput = document.getElementById('userSecStartTime');
    const endInput = document.getElementById('userSecEndTime');
    const badge = document.getElementById('userSecWorkDurationBadge');

    const isCustom = tokenExpSelect?.value === 'custom';
    if (workHoursBox) {
      workHoursBox.style.display = isCustom ? 'block' : 'none';
    }

    if (isCustom && startInput && endInput && badge) {
      const [h1, m1] = (startInput.value || '08:00').split(':').map(Number);
      const [h2, m2] = (endInput.value || '16:00').split(':').map(Number);
      let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (diff <= 0) diff += 24 * 60;
      const hours = (diff / 60).toFixed(1).replace('.0', '');
      badge.textContent = `${hours} ساعات عمل`;
    }
  },

  // ================== تطبيق قوالب الصلاحيات التلقائية ==================

  // فك قفل الجهاز المعتمد لمستخدم من داخل نافذة تعديل المستخدم
  async resetUserBoundDevice() {
    const userId = document.getElementById('userId')?.value;
    if (!userId) {
      const boundText = document.getElementById('userSecBoundDeviceText');
      const boundResetBtn = document.getElementById('btnUserSecResetBoundDevice');
      if (boundText) boundText.textContent = '📱 الجهاز المعتمد: لم يسجل بعد';
      if (boundResetBtn) boundResetBtn.style.display = 'none';
      return;
    }
    if (!confirm('هل تريد فك قفل الجهاز المعتمد لهذا المستخدم؟ سيتمكن من تسجيل الدخول من جهاز جديد واعتماده.')) {
      return;
    }
    try {
      const res = await fetch(`/api/users/${userId}/reset-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': Auth.token ? `Bearer ${Auth.token}` : ''
        }
      });
      const data = await res.json();
      if (data.success) {
        const boundText = document.getElementById('userSecBoundDeviceText');
        const boundResetBtn = document.getElementById('btnUserSecResetBoundDevice');
        if (boundText) boundText.textContent = '📱 الجهاز المعتمد: تم فك الارتباط (سيتم اعتماد الجهاز القادم)';
        if (boundResetBtn) boundResetBtn.style.display = 'none';
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message, 'success');
        } else {
          alert(data.message);
        }
        await this.loadUsers();
      } else {
        alert(data.message || 'حدث خطأ أثناء فك الربط');
      }
    } catch (e) {
      alert('خطأ: ' + e.message);
    }
  },

  onRoleChange() {
    const role = document.getElementById('userRoleVal')?.value;
    if (role && role !== 'custom') {
      this.applyRolePermissionsPreset(role);
    }
  },

  applyRolePermissionsPreset(role) {
    this.selectAllPermissions(false);

    let permsToSelect = [];

    switch (role) {
      case 'admin':
        this.selectAllPermissions(true);
        return;
      case 'accountant':
        permsToSelect = [
          'dashboard:view', 'dashboard:export',
          'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:export',
          'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:export',
          'revenues:view', 'revenues:create', 'revenues:edit', 'revenues:export',
          'billing:view', 'billing:create', 'billing:edit', 'billing:export',
          'custody:view', 'custody:create', 'custody:export',
          'clients:view', 'clients:create', 'clients:export',
          'suppliers:view', 'suppliers:create', 'suppliers:export',
          'cash:view',
          'hr:view',
          'reports:view', 'reports:export'
        ];
        break;
      case 'auditor':
        permsToSelect = [
          'dashboard:view', 'dashboard:export',
          'accounting:view', 'accounting:approve', 'accounting:post', 'accounting:export',
          'expenses:view', 'expenses:approve', 'expenses:export',
          'revenues:view', 'revenues:approve', 'revenues:export',
          'billing:view', 'billing:approve', 'billing:export',
          'custody:view', 'custody:approve', 'custody:export',
          'projects:view', 'projects:export',
          'inventory:view', 'inventory:export',
          'purchases:view', 'purchases:approve', 'purchases:export',
          'hr:view', 'hr:approve', 'hr:export',
          'reports:view', 'reports:export',
          'cash:view'
        ];
        break;
      case 'project_manager':
        permsToSelect = [
          'dashboard:view',
          'projects:view', 'projects:create', 'projects:edit', 'projects:approve', 'projects:export',
          'expenses:view', 'expenses:create',
          'custody:view',
          'inventory:view', 'inventory:issue',
          'reports:view'
        ];
        break;
      case 'storekeeper':
        permsToSelect = [
          'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:issue', 'inventory:export',
          'purchases:view',
          'projects:view'
        ];
        break;
      default:
        return;
    }

    permsToSelect.forEach(val => {
      const chk = document.querySelector(`.perm-chk[value="${val}"]`);
      if (chk) chk.checked = true;
    });
  },

  selectAllPermissions(select) {
    document.querySelectorAll('.perm-chk').forEach(chk => {
      chk.checked = !!select;
    });
  },

  // ================== حفظ المستخدم والصلاحيات ==================
  async submitUserForm(e) {
    if (e) e.preventDefault();

    const id = document.getElementById('userIdVal')?.value;
    const full_name = document.getElementById('userNameVal')?.value?.trim();
    const username = document.getElementById('userUsernameVal')?.value?.trim();
    const password = document.getElementById('userPasswordVal')?.value;
    const role = document.getElementById('userRoleVal')?.value;
    const phone = document.getElementById('userPhoneVal')?.value?.trim();
    const email = document.getElementById('userEmailVal')?.value?.trim();
    const status = document.getElementById('userStatusVal')?.value || 'active';

    if (!full_name || !username) {
      App.showToast('يرجى ملء الاسم الكامل واسم المستخدم', 'error');
      return;
    }

    if (!id && (!password || password.length < 4)) {
      App.showToast('يرجى إدخال كلمة مرور مناسبة (4 خانات على الأقل)', 'error');
      return;
    }

    // Gather checked permissions
    const checkedPerms = Array.from(document.querySelectorAll('.perm-chk:checked')).map(c => c.value);

    // استخراج وضبط إعدادات الأمان والجلسات من البطاقة المخصصة
    let userSecuritySettings = undefined;
    const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';

    if (isCurrentUserAdmin) {
      const policyType = document.getElementById('userSecPolicyType')?.value || 'inherit';
      const expVal = document.getElementById('userSecTokenExpiry')?.value || '8h';
      const isCustomWorkHours = (expVal === 'custom');
      const startWork = document.getElementById('userSecStartTime')?.value || '08:00';
      const endWork = document.getElementById('userSecEndTime')?.value || '16:00';

      let hours = 8;
      if (isCustomWorkHours) {
        const [h1, m1] = startWork.split(':').map(Number);
        const [h2, m2] = endWork.split(':').map(Number);
        let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (diff <= 0) diff += 24 * 60;
        hours = Math.max(1, Math.round(diff / 60));
      } else if (expVal.endsWith('h')) {
        hours = parseInt(expVal);
      } else if (expVal.endsWith('d')) {
        hours = parseInt(expVal) * 24;
      }

      if (policyType === 'lock_device') {
        userSecuritySettings = {
          sessionMode: 'strict_single',
          maxSessions: 1,
          overflowAction: 'lock_device',
          session_overflow_action: 'lock_device',
          session_mode: 'single',
          session_device_limit: 1,
          jwt_token_expiry: expVal,
          tokenExpiryPreset: expVal,
          tokenExpiryHours: hours,
          work_start_time: startWork,
          work_end_time: endWork,
          work_hours_enabled: isCustomWorkHours,
          updated_at: new Date().toISOString()
        };
      } else if (policyType === 'strict_single') {
        const overflow = document.getElementById('userSecOverflowAction')?.value || 'kick_oldest';
        userSecuritySettings = {
          sessionMode: 'strict_single',
          maxSessions: 1,
          overflowAction: overflow,
          session_overflow_action: overflow,
          session_mode: 'single',
          session_device_limit: 1,
          jwt_token_expiry: expVal,
          tokenExpiryPreset: expVal,
          tokenExpiryHours: hours,
          work_start_time: startWork,
          work_end_time: endWork,
          work_hours_enabled: isCustomWorkHours,
          updated_at: new Date().toISOString()
        };
      } else if (policyType === 'multi_device') {
        const limit = parseInt(document.getElementById('userSecDeviceLimit')?.value || '3');
        const overflow = document.getElementById('userSecOverflowAction')?.value || 'kick_oldest';

        userSecuritySettings = {
          sessionMode: 'multi_device',
          maxSessions: limit,
          overflowAction: overflow,
          session_overflow_action: overflow,
          session_mode: 'multi',
          session_device_limit: limit,
          jwt_token_expiry: expVal,
          tokenExpiryPreset: expVal,
          tokenExpiryHours: hours,
          work_start_time: startWork,
          work_end_time: endWork,
          work_hours_enabled: isCustomWorkHours,
          updated_at: new Date().toISOString()
        };
      } else {
        // inherit: نرسل null ليتم وراثة إعدادات النظام العامة
        userSecuritySettings = null;
      }

      // إذا كان المستخدم قيد التعديل ولديه جهاز معتمد مسجل، نحافظ على بيانات الجهاز المعتمد
      const editUserId = document.getElementById('userId')?.value;
      if (editUserId && userSecuritySettings) {
        const existingUser = this._cachedUsers?.find(u => String(u.id) === String(editUserId));
        let prevSec = {};
        if (existingUser && existingUser.security_settings) {
          try {
            prevSec = typeof existingUser.security_settings === 'string'
              ? JSON.parse(existingUser.security_settings)
              : existingUser.security_settings;
          } catch (e) {}
        }
        if (prevSec.authorized_device_id) {
          userSecuritySettings.authorized_device_id = prevSec.authorized_device_id;
          userSecuritySettings.authorized_device_name = prevSec.authorized_device_name;
          userSecuritySettings.authorized_device_at = prevSec.authorized_device_at;
        }
      }
    }

    let finalPerms = [...checkedPerms];
    let finalRole = role;

    const totalCheckboxes = document.querySelectorAll('.perm-chk').length;
    if (finalRole === 'admin' && finalPerms.length >= totalCheckboxes) {
      if (!finalPerms.includes('all')) finalPerms.unshift('all');
    } else if (finalPerms.length < totalCheckboxes && finalRole === 'admin' && username !== 'admin') {
      finalRole = 'custom';
    }

    // قراءة والتحقق من رمز التحقق بخطوتين (2FA PIN)
    const pinInput = document.getElementById('user2FaPinVal');
    const tfaEnabledChk = document.getElementById('user2FaEnabledVal');
    
    const normalizeDigits = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
        .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
        .replace(/[^0-9]/g, '')
        .trim();
    };

    const twoFactorPin = normalizeDigits(pinInput ? pinInput.value : '123456');
    const twoFactorEnabled = tfaEnabledChk ? (tfaEnabledChk.checked ? 1 : 0) : 1;

    if (twoFactorEnabled && twoFactorPin) {
      if (!/^\d{6}$/.test(twoFactorPin)) {
        App.showToast('رمز التحقق بخطوتين (PIN) يجب أن يتكون من 6 أرقام تماماً', 'warning');
        if (pinInput) pinInput.focus();
        return;
      }
    }

    // قراءة وتحديد نطاق الصلاحيات الجغرافي والإداري (Branch / Dept / Projects)
    const branch_id = document.getElementById('userBranchVal')?.value || null;
    const department_id = document.getElementById('userDepartmentVal')?.value || null;
    const allProjScope = document.getElementById('userAllProjectsScopeChk')?.checked;
    let allowed_projects = 'all';
    if (!allProjScope) {
      const selectedProjIds = Array.from(document.querySelectorAll('.user-proj-scope-chk:checked')).map(c => Number(c.value));
      allowed_projects = selectedProjIds;
    }

    const payload = {
      full_name,
      username,
      role: finalRole,
      phone,
      email,
      status,
      permissions: finalPerms,
      two_factor_pin: twoFactorPin || '123456',
      two_factor_enabled: twoFactorEnabled,
      branch_id: branch_id ? Number(branch_id) : null,
      department_id: department_id ? Number(department_id) : null,
      allowed_projects
    };

    if (userSecuritySettings !== undefined) {
      payload.security_settings = userSecuritySettings;
    }

    if (password && password.trim().length > 0) {
      payload.password = password;
    }

    const saveBtn = document.getElementById('btnSaveUser');
    const originalBtnText = saveBtn ? saveBtn.innerHTML : 'حفظ';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const url = id ? `/api/users/${id}` : '/api/users';
      const method = id ? 'PUT' : 'POST';

      const headers = { 'Content-Type': 'application/json' };
      if (Auth.token) {
        headers['Authorization'] = `Bearer ${Auth.token}`;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload)
      });

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('استجابة غير متوقعة من الخادم (' + res.status + '). يرجى إعادة تشغيل الخادم وتحديث الصفحة.');
      }

      if (res.ok && data.success) {
        App.showToast(data.message || 'تم حفظ المستخدم وتعيين الصلاحيات بنجاح!', 'success');
        App.closeModal('newUserModal');
        await this.loadUsers();
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء حفظ المستخدم', 'error');
      }
    } catch (err) {
      console.error('Error saving user:', err);
      App.showToast('تعذر الاتصال بالخادم لحفظ المستخدم', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
      }
    }
  },

  // ================== تبديل حالة المستخدم ==================
  async toggleUserStatus(userId) {
    try {
      const res = await fetch(`/api/users/${userId}/status`, {
        method: 'PATCH'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message, 'success');
        await this.loadUsers();
      } else {
        App.showToast(data.message || 'تعذر تغيير حالة الحساب', 'error');
      }
    } catch (e) {
      App.showToast('خطأ في الاتصال بالخادم', 'error');
    }
  },

  // ================== حذف مستخدم ==================
  async deleteUser(userId, username) {
    if (window.UI && UI.UndoManager) {
      const row = document.querySelector(`tr[data-user-id="${userId}"]`) || document.getElementById(`userRow_${userId}`);
      if (row) row.style.display = 'none';

      UI.UndoManager.deferAction({
        id: `delete_user_${userId}`,
        description: `🗑️ تم حذف حساب المستخدم (${username}) مؤقتاً`,
        timeout: 6500,
        onUndo: () => {
          if (row) row.style.display = '';
        },
        onCommit: async () => {
          try {
            const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok && data.success) {
              await this.loadUsers();
            } else {
              App.showToast(data.message || 'تعذر حذف المستخدم', 'error');
              if (row) row.style.display = '';
            }
          } catch (e) {
            App.showToast('خطأ في الاتصال بالخادم', 'error');
            if (row) row.style.display = '';
          }
        }
      });
    } else {
      if (!confirm(`هل أنت متأكد من حذف المستخدم (${username}) نهائياً من النظام؟`)) {
        return;
      }

      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (res.ok && data.success) {
          App.showToast(data.message, 'success');
          await this.loadUsers();
        } else {
          App.showToast(data.message || 'تعذر حذف المستخدم', 'error');
        }
      } catch (e) {
        App.showToast('خطأ في الاتصال بالخادم', 'error');
      }
    }
  },

  // ================== إنهاء جلسة مستخدم وفصله عن النظام ==================
  async disconnectUser(userId, userName) {
    const isConfirm = confirm(`هل أنت متأكد من رغبتك في إنهاء جلسة المستخدم (${userName}) وفصله عن النظام فوراً لمنع التكرار؟`);
    if (!isConfirm) return;

    try {
      const res = await fetch(`/api/users/${userId}/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message || `تم إنهاء جلسة (${userName}) وفصله بنجاح`, 'success');
        await this.loadUsers();
      } else {
        App.showToast(data.message || 'تعذر إنهاء جلسة المستخدم', 'error');
      }
    } catch (e) {
      App.showToast('خطأ في الاتصال بالخادم أثناء فصل المستخدم', 'error');
    }
  },

  // ================== تنزيل نسخة احتياطية ==================
  async downloadBackup() {
    try {
      App.showToast('جاري تحضير وتنزيل النسخة الاحتياطية لقاعدة البيانات...', 'info');
      window.location.href = '/api/settings/backup';
    } catch (e) {
      App.showToast('خطأ في تنزيل النسخة الاحتياطية', 'error');
    }
  },

  // ================== استعادة النسخ الاحتياطية ==================
  openRestoreModal() {
    this._selectedBackupFile = null;
    this._selectedServerBackupName = null;

    const fileInput = document.getElementById('backupFileInput');
    if (fileInput) fileInput.value = '';

    const dropzoneText = document.getElementById('selectedBackupFileName');
    if (dropzoneText) dropzoneText.textContent = 'أو اسحب وأفلت الملف هنا';

    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (confirmBtn) confirmBtn.disabled = true;

    App.openModal('restoreBackupModal');
    this.loadServerBackups();
  },

  handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite')) {
      App.showToast('يرجى اختيار ملف قاعدة بيانات صالح بصيغة (.db أو .sqlite)', 'error');
      return;
    }

    this._selectedBackupFile = file;
    this._selectedServerBackupName = null;

    const dropzoneText = document.getElementById('selectedBackupFileName');
    if (dropzoneText) {
      const sizeKB = (file.size / 1024).toFixed(1);
      dropzoneText.innerHTML = `<strong style="color: var(--gold-light);">الملف المحدد:</strong> ${file.name} (${sizeKB} KB)`;
    }

    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (confirmBtn) confirmBtn.disabled = false;
  },

  selectServerBackup(fileName) {
    this._selectedServerBackupName = fileName;
    this._selectedBackupFile = null;

    const fileInput = document.getElementById('backupFileInput');
    if (fileInput) fileInput.value = '';

    const dropzoneText = document.getElementById('selectedBackupFileName');
    if (dropzoneText) {
      dropzoneText.innerHTML = `<strong style="color: var(--accent-blue);">تم اختيار نسخة من الخادم:</strong> ${fileName}`;
    }

    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (confirmBtn) confirmBtn.disabled = false;

    App.showToast(`تم اختيار النسخة: ${fileName}`, 'info');
  },

  async loadServerBackups() {
    try {
      const res = await fetch('/api/settings/backups');
      const json = await res.json();
      const container = document.getElementById('serverBackupsList');
      const section = document.getElementById('serverBackupsSection');
      if (container && section) {
        if (json.success && json.data && json.data.length > 0) {
          section.style.display = 'block';
          container.innerHTML = json.data.map(b => {
            const dateStr = new Date(b.createdAt).toLocaleString('ar-YE');
            const sizeKB = (b.size / 1024).toFixed(1);
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
                <div>
                  <div style="font-size: 0.85rem; font-weight: 600; color: var(--gold-light);">${b.fileName}</div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary);">${dateStr} | ${sizeKB} KB</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.selectServerBackup('${b.fileName}')">
                  اختيار هذه النسخة
                </button>
              </div>
            `;
          }).join('');
        } else {
          section.style.display = 'none';
        }
      }
    } catch (e) {
      console.error('Error loading backups:', e);
    }
  },

  async executeRestore() {
    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (!this._selectedBackupFile && !this._selectedServerBackupName) {
      App.showToast('يرجى اختيار ملف النسخة الاحتياطية أولاً', 'error');
      return;
    }

    const targetName = this._selectedBackupFile ? this._selectedBackupFile.name : this._selectedServerBackupName;
    if (!confirm(`هل أنت متأكد تماماً من استعادة النسخة الاحتياطية (${targetName})؟\n\nتنبيه: سيتم استبدال كافة البيانات الحالية ببيانات النسخة المحددة.`)) {
      return;
    }

    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : 'بدء الاستعادة والتأكيد';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳</span> جاري استعادة قاعدة البيانات والتحقق...';
    }

    try {
      let res;
      if (this._selectedBackupFile) {
        res = await fetch('/api/settings/restore-upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(this._selectedBackupFile.name)
          },
          body: this._selectedBackupFile
        });
      } else {
        res = await fetch('/api/settings/restore-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: this._selectedServerBackupName })
        });
      }

      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message || 'تمت استعادة قاعدة البيانات بنجاح! جاري تحديث الصفحة...', 'success');
        App.closeModal('restoreBackupModal');
        setTimeout(() => {
          window.location.reload();
        }, 1800);
      } else {
        App.showToast(data.message || 'فشلت عملية استعادة النسخة الاحتياطية', 'error');
      }
    } catch (e) {
      console.error('Restore error:', e);
      App.showToast('فشل الاتصال بالخادم أثناء استعادة النسخة الاحتياطية', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  // ================== إدارة الربط السحابي وقاعدة البيانات ==================
  async loadDbConfig() {
    try {
      const res = await fetch('/api/settings/db-status');
      const json = await res.json();
      if (json && json.success) {
        const d = json.data;
        const modeEl = document.getElementById('cfgDbMode');
        const urlEl = document.getElementById('cfgOnlineUrl');
        const statusBox = document.getElementById('dbConfigStatusBox');

        if (modeEl && d.mode) modeEl.value = d.mode;
        if (urlEl) urlEl.value = d.rawOnlineUrl || '';

        if (statusBox) {
          const badgeClass = d.isOnline ? 'badge-active' : 'badge-warning';
          const badgeText = d.isOnline ? '🟢 أونلاين (سحابي متصل)' : '🟠 أوفلاين (محلي نشط)';
          statusBox.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
              <span>حالة الاتصال الحالية: <strong class="badge ${badgeClass}">${badgeText}</strong></span>
              <span>زمن الاستجابة: <strong>${d.latencyMs || 0} ms</strong></span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4;">${d.statusMessage}</div>
          `;
        }
      }
    } catch (e) {
      console.error('Error loading db config:', e);
    }
  },

  async testOnlineDb() {
    const urlInput = document.getElementById('cfgOnlineUrl');
    const resultBox = document.getElementById('onlineDbTestResult');
    const btn = document.getElementById('btnTestOnlineDb');
    const testUrl = urlInput ? urlInput.value.trim() : '';

    if (!testUrl) {
      App.showToast('يرجى إدخال رابط السيرفر/قاعدة البيانات السحابية للاختبار أولاً', 'warning');
      if (urlInput) urlInput.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الفحص والتحقق... ⏳';
    }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<span style="color: var(--text-secondary);">جاري إرسال إشارة الفحص والتحقق من الاستجابة...</span>';
    }

    try {
      const res = await fetch('/api/settings/test-online-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: testUrl })
      });
      const json = await res.json();
      const d = json.data || {};

      if (json.success && d.isOnline) {
        App.showToast('تم التحقق بنجاح! السيرفر السحابي متصل ومستجيب 🟢', 'success');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 4px;">✅ تم الاتصال بنجاح (${d.latencyMs} ms)</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${d.message}</div>
          `;
        }
      } else {
        App.showToast('تعذر الاتصال بالسيرفر السحابي، التحويل التلقائي للقاعدة المحلية نشط 🟠', 'warning');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-red); font-weight: 700; margin-bottom: 4px;">⚠️ تعذر الاتصال بالسيرفر السحابي</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${d.message || json.message}</div>
          `;
        }
      }
    } catch (e) {
      if (resultBox) {
        resultBox.innerHTML = `<div style="color: var(--accent-red);">خطأ أثناء محاولة الفحص: ${e.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'فحص الاتصال والتحقق الآن 🔍';
      }
    }
  },

  async saveDbConfig(e) {
    if (e) e.preventDefault();
    const mode = document.getElementById('cfgDbMode')?.value || 'auto';
    const onlineUrl = document.getElementById('cfgOnlineUrl')?.value || '';

    try {
      const res = await fetch('/api/settings/update-db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, onlineUrl })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم حفظ إعدادات الاتصال وتحديث وضع العمل بنجاح ✅', 'success');
        await this.loadDbConfig();
        if (typeof App !== 'undefined' && App.checkDatabaseStatus) {
          await App.checkDatabaseStatus();
        }
      } else {
        App.showToast('تعذر حفظ إعدادات الاتصال: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء حفظ الإعدادات: ' + err.message, 'error');
    }
  },

  // ================== نسخ الخروج الاحتياطية التلقائية ==================
  async loadLogoutBackups() {
    try {
      const res = await fetch('/api/settings/logout-backups');
      const json = await res.json();
      const tbody = document.getElementById('logoutBackupsTableBody');
      if (!tbody) return;

      if (json.success && json.data && json.data.length > 0) {
        tbody.innerHTML = json.data.map(b => {
          const sizeKB = (b.size / 1024).toFixed(1);
          const modeBadge = b.mode === 'online' 
            ? '<span class="badge badge-active" style="font-size: 0.72rem;">أونلاين سحابي</span>'
            : '<span class="badge badge-warning" style="font-size: 0.72rem;">أوفلاين محلي</span>';

          return `
            <tr>
              <td>
                <div style="font-weight: 700; color: var(--gold-light); font-size: 0.85rem;">${b.fileName}</div>
                <small style="color: var(--text-secondary);">${b.notes || '-'}</small>
              </td>
              <td><span class="badge badge-secondary">${b.username || 'مستخدم'}</span></td>
              <td>${b.displayTime || b.timestamp}</td>
              <td>${sizeKB} KB</td>
              <td>${modeBadge}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.confirmRestoreLogoutBackup('${b.fileName}')" title="استعادة هذه النقطة الزمنية">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle;"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                  <span>استعادة</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 25px; color: var(--text-secondary);">
              لم يتم تسجيل أي نسخ خروج تلقائية بعد. سيقوم النظام بإنشاء نسخة فورية عند كل تسجيل خروج للمستخدم لحفظ آخر التعديلات.
            </td>
          </tr>
        `;
      }
    } catch (e) {
      console.error('Error loading logout backups:', e);
    }
  },

  confirmRestoreLogoutBackup(fileName) {
    if (!confirm(`هل ترغب في استعادة النسخة الاحتياطية (${fileName})؟\n\nستتم إعادة المشروع تماماً إلى اللحظة التي تم فيها تسجيل الخروج وحفظ تلك النسخة.`)) {
      return;
    }
    this.selectServerBackup(fileName);
    this.executeRestore();
  },

  // ================== الجدولة التلقائية للنسخ الاحتياطي ومسار التخزين ==================
  async loadAutoBackupSchedule() {
    try {
      const res = await fetch('/api/settings/auto-backup/status');
      const json = await res.json();
      if (!json.success || !json.data) return;
      const d = json.data;

      // ملء حقول النموذج
      const enabledSel = document.getElementById('cfgAutoBackupEnabled');
      const intervalSel = document.getElementById('cfgAutoBackupInterval');
      const daySel = document.getElementById('cfgAutoBackupDayOfWeek');
      const timeInp = document.getElementById('cfgAutoBackupTime');
      const maxFilesSel = document.getElementById('cfgAutoBackupMaxFiles');
      const pathInp = document.getElementById('cfgAutoBackupPath');

      if (enabledSel) enabledSel.value = d.enabled ? 'true' : 'false';
      if (intervalSel) intervalSel.value = d.interval || 'daily';
      if (daySel) daySel.value = String(d.dayOfWeek !== undefined ? d.dayOfWeek : 5);
      if (timeInp) timeInp.value = d.time || '02:00';
      if (maxFilesSel) maxFilesSel.value = String(d.maxFiles || 14);
      if (pathInp) {
        pathInp.value = d.storagePath || d.defaultStoragePath || '';
        pathInp.dataset.defaultPath = d.defaultStoragePath || '';
      }

      this.toggleAutoBackupFields();

      // تحديث بطاقة الحالة الحية
      const statusBadge = document.getElementById('liveBackupStatusBadge');
      const intervalText = document.getElementById('liveBackupIntervalText');
      const lastRunText = document.getElementById('liveBackupLastRunText');
      const nextRunText = document.getElementById('liveBackupNextRunText');
      const pathStatus = document.getElementById('cfgAutoBackupPathStatus');

      if (statusBadge) {
        if (!d.enabled) {
          statusBadge.innerHTML = '🟡 معطل مؤقتاً';
          statusBadge.style.color = '#facc15';
        } else if (d.lastStatus === 'failed') {
          statusBadge.innerHTML = '🔴 فشل آخر نسخ';
          statusBadge.style.color = '#f87171';
        } else {
          statusBadge.innerHTML = '🟢 مفعل ومنتظم';
          statusBadge.style.color = '#4ade80';
        }
      }

      if (intervalText) {
        intervalText.textContent = d.interval === 'weekly'
          ? `أسبوعياً (كل ${d.dayOfWeekName || 'جمعة'} في تمام ${d.time || '02:00'})`
          : `يومياً في تمام ${d.time || '02:00'}`;
      }

      if (lastRunText) {
        if (d.lastRun) {
          const lrDate = new Date(d.lastRun);
          const sizeMb = d.lastSize ? `(${(d.lastSize / (1024 * 1024)).toFixed(2)} MB)` : '';
          lastRunText.innerHTML = `${lrDate.toLocaleDateString('ar-YE')} ${lrDate.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })} ${sizeMb} ${d.lastStatus === 'success' ? '✅' : '❌'}`;
        } else {
          lastRunText.textContent = 'لا توجد نسخ سابقة';
        }
      }

      if (nextRunText) {
        if (d.nextRun && d.enabled) {
          const nrDate = new Date(d.nextRun);
          const nextTime = `${nrDate.toLocaleDateString('ar-YE')} ${nrDate.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}`;
          nextRunText.innerHTML = `${nextTime} <span style="font-size:0.8rem; color:#94a3b8;">(${d.countdownText || ''})</span>`;
        } else {
          nextRunText.textContent = d.enabled ? 'جاري الحساب...' : 'الجدولة متوقفة';
        }
      }

      if (pathStatus) {
        if (d.storagePathExists && d.storagePathWritable) {
          pathStatus.innerHTML = '<span style="color:#4ade80;">(مسار صالح ومؤكد ✅)</span>';
        } else if (d.storagePathExists) {
          pathStatus.innerHTML = '<span style="color:#facc15;">(المسار موجود - يتطلب فحص الصلاحيات)</span>';
        } else {
          pathStatus.innerHTML = '<span style="color:#38bdf8;">(سيتم إنشاء المجلد تلقائياً)</span>';
        }
      }
    } catch (e) {
      console.error('Error loading auto backup schedule:', e);
    }
  },

  toggleAutoBackupFields() {
    const enabled = document.getElementById('cfgAutoBackupEnabled')?.value === 'true';
    const interval = document.getElementById('cfgAutoBackupInterval')?.value;
    const dayGroup = document.getElementById('cfgAutoBackupDayGroup');

    if (dayGroup) {
      dayGroup.style.display = (enabled && interval === 'weekly') ? 'block' : 'none';
    }
  },

  async saveAutoBackupSchedule(event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('btnSaveAutoBackupConfig');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>جاري الحفظ... ⏳</span>';
    }

    const payload = {
      enabled: document.getElementById('cfgAutoBackupEnabled')?.value === 'true',
      interval: document.getElementById('cfgAutoBackupInterval')?.value || 'daily',
      dayOfWeek: Number(document.getElementById('cfgAutoBackupDayOfWeek')?.value || 5),
      time: document.getElementById('cfgAutoBackupTime')?.value || '02:00',
      maxFiles: Number(document.getElementById('cfgAutoBackupMaxFiles')?.value || 14),
      storagePath: document.getElementById('cfgAutoBackupPath')?.value?.trim() || ''
    };

    try {
      const res = await fetch('/api/settings/auto-backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم حفظ إعدادات الجدولة التلقائية بنجاح 🛡️', 'success');
        await this.loadAutoBackupSchedule();
        if (typeof App !== 'undefined' && App.fetchAutoBackupStatus) {
          App.fetchAutoBackupStatus();
        }
      } else {
        App.showToast(json.message || 'فشل حفظ الإعدادات', 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء حفظ إعدادات الجدولة', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async runAutoBackupNow() {
    const btn = document.getElementById('btnSettingsRunBackupNow');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>جاري التنفيذ... ⏳</span>';
    }

    try {
      const res = await fetch('/api/settings/auto-backup/run-now', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم إنشاء النسخة التلقائية المجدولة بنجاح وحفظها 🛡️', 'success');
        await this.loadAutoBackupSchedule();
        if (typeof App !== 'undefined' && App.fetchAutoBackupStatus) {
          App.fetchAutoBackupStatus();
        }
      } else {
        App.showToast(json.message || 'فشل تنفيذ النسخ التلقائي', 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء تشغيل النسخ التلقائي', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async testStoragePath() {
    const pathInp = document.getElementById('cfgAutoBackupPath');
    const resultBox = document.getElementById('autoBackupTestResultBox');
    const pathStatus = document.getElementById('cfgAutoBackupPathStatus');
    const pathVal = pathInp?.value?.trim();

    if (!pathVal) {
      App.showToast('يرجى إدخال مسار التخزين أولاً', 'warning');
      return;
    }

    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.style.background = 'rgba(255,255,255,0.05)';
      resultBox.style.color = '#94a3b8';
      resultBox.innerHTML = 'جاري اختبار المسار وصلاحيات الكتابة... ⏳';
    }

    try {
      const res = await fetch('/api/settings/auto-backup/test-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathVal })
      });
      const json = await res.json();
      if (resultBox) {
        if (json.success) {
          resultBox.style.background = 'rgba(34, 197, 94, 0.15)';
          resultBox.style.color = '#4ade80';
          resultBox.style.border = '1px solid rgba(34, 197, 94, 0.3)';
          resultBox.innerHTML = `<strong>${json.message}</strong><br><small style="direction:ltr; display:block; color:#f8fafc; font-family:monospace;">${json.resolvedPath}</small>`;
          if (pathStatus) pathStatus.innerHTML = '<span style="color:#4ade80;">(مسار صالح ومؤكد ✅)</span>';
        } else {
          resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resultBox.style.color = '#f87171';
          resultBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          resultBox.innerHTML = `<strong>⚠️ ${json.message}</strong>`;
          if (pathStatus) pathStatus.innerHTML = '<span style="color:#f87171;">(تعذر استخدام المسار ❌)</span>';
        }
      }
    } catch (err) {
      if (resultBox) {
        resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
        resultBox.style.color = '#f87171';
        resultBox.innerHTML = 'خطأ أثناء الاتصال بالخادم لاختبار المسار';
      }
    }
  },

  resetDefaultStoragePath() {
    const pathInp = document.getElementById('cfgAutoBackupPath');
    if (pathInp) {
      pathInp.value = pathInp.dataset.defaultPath || 'server/database/backups';
      App.showToast('تم استعادة المسار الافتراضي للنسخ الاحتياطية', 'info');
      this.testStoragePath();
    }
  },

  // ================== إدارة ومزامنة خادم MySQL ==================
  async loadMysqlStatus() {
    try {
      const res = await fetch('/api/settings/mysql-status');
      const json = await res.json();
      if (json && json.success) {
        const d = json.data;
        const statusBox = document.getElementById('mysqlStatusBox');
        const hostInput = document.getElementById('mysqlHost');
        const portInput = document.getElementById('mysqlPort');
        const userInput = document.getElementById('mysqlUser');
        const dbInput = document.getElementById('mysqlDatabase');

        if (d.mysqlConfig) {
          if (hostInput && !hostInput.value) hostInput.value = d.mysqlConfig.host || 'localhost';
          if (portInput && !portInput.value) portInput.value = d.mysqlConfig.port || 3306;
          if (userInput && !userInput.value) userInput.value = d.mysqlConfig.user || 'root';
          if (dbInput && !dbInput.value) dbInput.value = d.mysqlConfig.database || 'rawasi_aden';
        }

        if (statusBox) {
          const isMySqlActive = d.activeEngine === 'mysql';
          const isConnected = d.isConnected;
          let badgeClass = 'badge-warning';
          let badgeText = 'محرك SQLite المحلي نشط (نمط الطوارئ / أوفلاين)';

          if (isMySqlActive && isConnected) {
            badgeClass = 'badge-active';
            badgeText = `خادم MySQL نشط ومتصل بنجاح (${d.serverVersion || 'v8.x'}) 🟢`;
          } else if (isConnected) {
            badgeClass = 'badge-info';
            badgeText = 'خادم MySQL متصل وجاهز للتبديل ✅';
          }

          statusBox.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
              <span>المحرك النشط حالياً: <strong class="badge ${badgeClass}">${badgeText}</strong></span>
              <span>الإصدار: <strong>${d.serverVersion || 'SQLite 3.x'}</strong></span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5;">${d.message}</div>
          `;
        }
      }
    } catch (e) {
      console.error('Error loading MySQL status:', e);
    }
  },

  async testMysqlConnection() {
    const host = document.getElementById('mysqlHost')?.value.trim() || 'localhost';
    const port = document.getElementById('mysqlPort')?.value.trim() || 3306;
    const user = document.getElementById('mysqlUser')?.value.trim() || 'root';
    const password = document.getElementById('mysqlPassword')?.value || '';
    const database = document.getElementById('mysqlDatabase')?.value.trim() || 'rawasi_aden';
    const resultBox = document.getElementById('mysqlTestResult');
    const btn = document.getElementById('btnTestMysql');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري اختبار الاتصال بقاعدة MySQL... ⏳';
    }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<span style="color: var(--text-secondary);">جاري محاولة الاتصال بـ MySQL عبر المنفذ ' + port + '...</span>';
    }

    try {
      const res = await fetch('/api/settings/test-mysql-conn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, user, password, database })
      });
      const json = await res.json();

      if (json.success) {
        App.showToast('تم الاتصال بنجاح بخادم MySQL 🚀', 'success');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 4px;">✅ تم الاتصال بنجاح بخادم MySQL (${json.latencyMs} ms)</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${json.message} | إصدار الخادم: ${json.version || 'غير محدد'} | المستخدم: ${json.user || user}</div>
          `;
        }
      } else {
        App.showToast('تعذر الاتصال بـ MySQL: ' + json.message, 'error');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-red); font-weight: 700; margin-bottom: 4px;">⚠️ فشل الاتصال بخادم MySQL</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${json.message}</div>
            <div style="font-size: 0.78rem; color: var(--gold-light); margin-top: 6px;">💡 تلميح: تأكد من تشغيل خادم MySQL (مثل XAMPP أو WampServer أو خدمة MySQL)، أو فحص كلمة المرور واسم المستخدم.</div>
          `;
        }
      }
    } catch (e) {
      if (resultBox) {
        resultBox.innerHTML = `<div style="color: var(--accent-red);">خطأ أثناء محاولة الفحص: ${e.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'اختبار الاتصال بـ MySQL 🔍';
      }
    }
  },

  async saveMysqlSettings(e) {
    if (e) e.preventDefault();
    const host = document.getElementById('mysqlHost')?.value.trim() || 'localhost';
    const port = document.getElementById('mysqlPort')?.value.trim() || 3306;
    const user = document.getElementById('mysqlUser')?.value.trim() || 'root';
    const password = document.getElementById('mysqlPassword')?.value || '';
    const database = document.getElementById('mysqlDatabase')?.value.trim() || 'rawasi_aden';
    const btn = document.getElementById('btnSaveMysql');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الحفظ والتطبيق... ⏳';
    }

    try {
      const res = await fetch('/api/settings/save-mysql-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, user, password, database })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم حفظ إعدادات MySQL بنجاح ✅', 'success');
        await this.loadMysqlStatus();
      } else {
        App.showToast(json.message || 'حدث خطأ أثناء حفظ الإعدادات', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في حفظ الإعدادات: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'حفظ الإعدادات وتفعيل المحرك 💾';
      }
    }
  },

  async runMysqlMigration() {
    const isConfirmed = confirm(
      "هل أنت متأكد من رغبتك في بدء ترحيل كافة الجداول والبيانات من SQLite إلى MySQL الآن؟\n\n" +
      "• سيتم نسخ كافة المشاريع، الفواتير، السندات، الحسابات، والعملاء.\n" +
      "• لن يتم حذف بياناتك القديمة من SQLite بل ستبقى محفوظة بأمان كنسخة احتياطية."
    );
    if (!isConfirmed) return;

    const resultBox = document.getElementById('mysqlMigrationResult');
    const btn = document.getElementById('btnRunMigration');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الترحيل الشامل للجداول والبيانات... ⏳';
    }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<div style="color: var(--gold-light);">جاري قراءة الجداول من SQLite وتحويلها إلى MySQL، يرجى الانتظار بضع ثوانٍ... ⏳</div>';
    }

    try {
      const res = await fetch('/api/settings/run-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم ترحيل كافة البيانات إلى MySQL بنجاح باهر! 🎉', 'success');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 4px;">🎉 اكتملت عملية الترحيل بنجاح تام!</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">${json.message}</div>
          `;
        }
        await this.loadMysqlStatus();
      } else {
        App.showToast('فشل الترحيل: ' + json.message, 'error');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-red); font-weight: 700; margin-bottom: 4px;">⚠️ تعذر إتمام الترحيل</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">${json.message}</div>
          `;
        }
      }
    } catch (err) {
      App.showToast('خطأ أثناء عملية الترحيل: ' + err.message, 'error');
      if (resultBox) {
        resultBox.innerHTML = `<div style="color: var(--accent-red);">خطأ غير متوقع: ${err.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'بدء ترحيل البيانات الآن (Migrate SQLite to MySQL) 🚀';
      }
    }
  },

  // ================== محرك الأرشفة الشاملة والمزامنة السحابية المشفرة ==================
  _cloudVaultItems: [],
  _selectedVaultRestoreFile: null,
  _selectedVaultArchiveName: null,

  async loadCloudBackupStatus() {
    try {
      const res = await fetch('/api/settings/cloud-backup/status');
      const json = await res.json();
      if (!json.success) return;

      const { config, vaultItems, systemStats } = json;
      this._cloudVaultItems = vaultItems || [];

      // تحديث شارات وبطاقات الحالة
      const badge = document.getElementById('cloudStatusBadge');
      if (badge) {
        if (config.lastSyncStatus === 'success') {
          badge.innerHTML = '<span style="color: #34d399;">🟢 متزامن ومحمي سحابياً</span>';
        } else if (config.lastSyncStatus === 'failed') {
          badge.innerHTML = '<span style="color: #f87171;">⚠️ تعثرت آخر مزامنة</span>';
        } else {
          badge.innerHTML = '<span style="color: #38bdf8;">☁️ جاهز للمزامنة</span>';
        }
      }

      const lastSyncEl = document.getElementById('cloudLastSyncTimeText');
      if (lastSyncEl) {
        lastSyncEl.textContent = config.lastSyncTime 
          ? new Date(config.lastSyncTime).toLocaleString('ar-YE')
          : 'لا توجد مزامنة سابقة';
      }

      const countEl = document.getElementById('cloudVaultFilesCountText');
      if (countEl) {
        countEl.textContent = `${this._cloudVaultItems.length} أرشيف محفوظ`;
      }

      // تعبئة نموذج إعدادات السحابة
      const pSelect = document.getElementById('cfgCloudProvider');
      if (pSelect && config.provider) pSelect.value = config.provider;

      const endInp = document.getElementById('cfgCloudEndpoint');
      if (endInp) endInp.value = config.endpointUrl || '';

      const tokInp = document.getElementById('cfgCloudToken');
      if (tokInp) tokInp.value = config.authToken || '';

      const fldInp = document.getElementById('cfgCloudFolder');
      if (fldInp) fldInp.value = config.syncedFolder || '';

      const autoSyncCheck = document.getElementById('cfgCloudAutoSync');
      if (autoSyncCheck) autoSyncCheck.checked = Boolean(config.autoSyncAfterBackup);

      this.toggleCloudProviderFields();
      this.renderCloudVaultTable();
    } catch (err) {
      console.warn('⚠️ [Settings] خطأ أثناء جلب حالة الخزنة السحابية:', err.message);
    }
  },

  toggleArchiveCryptoFields() {
    const chk = document.getElementById('cfgArchiveEncrypt');
    const grp = document.getElementById('archivePassphraseGroup');
    if (grp) {
      grp.style.display = (chk && chk.checked) ? 'block' : 'none';
    }
  },

  async generatePassphraseForArchive() {
    try {
      const res = await fetch('/api/settings/cloud-backup/generate-key');
      const json = await res.json();
      if (json.success && json.key) {
        const inp = document.getElementById('cfgArchivePassphrase');
        if (inp) {
          inp.value = json.key;
          inp.type = 'text';
          App.showToast('تم توليد مفتاح أمان تشفير فائق القوة 🔑', 'success');
        }
      }
    } catch (e) {
      // توليد محلي في حال الانقطاع
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
      let k = '';
      for (let i = 0; i < 24; i++) k += chars[Math.floor(Math.random() * chars.length)];
      const inp = document.getElementById('cfgArchivePassphrase');
      if (inp) inp.value = k;
      App.showToast('تم توليد مفتاح أمان عشوائي محلي 🔑', 'info');
    }
  },

  toggleCloudProviderFields() {
    const pVal = document.getElementById('cfgCloudProvider')?.value || 'cloud_vault';
    const endGrp = document.getElementById('grpCloudEndpoint');
    const tokGrp = document.getElementById('grpCloudToken');
    const fldGrp = document.getElementById('grpCloudFolder');

    if (endGrp) endGrp.style.display = (pVal === 's3_webhook') ? 'block' : 'none';
    if (tokGrp) tokGrp.style.display = (pVal === 's3_webhook') ? 'block' : 'none';
    if (fldGrp) fldGrp.style.display = (pVal === 'local_cloud_folder') ? 'block' : 'none';
  },

  async saveCloudSyncConfig(e) {
    if (e && e.preventDefault) e.preventDefault();
    const provider = document.getElementById('cfgCloudProvider')?.value || 'cloud_vault';
    const endpointUrl = document.getElementById('cfgCloudEndpoint')?.value?.trim() || '';
    const authToken = document.getElementById('cfgCloudToken')?.value?.trim() || '';
    const syncedFolder = document.getElementById('cfgCloudFolder')?.value?.trim() || '';
    const autoSyncAfterBackup = Boolean(document.getElementById('cfgCloudAutoSync')?.checked);

    try {
      App.showToast('جاري حفظ وتطبيق إعدادات السحابة...', 'info');
      const res = await fetch('/api/settings/cloud-backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          provider,
          endpointUrl,
          authToken,
          syncedFolder,
          autoSyncAfterBackup
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message, 'success');
        this.loadCloudBackupStatus();
      } else {
        App.showToast('فشل الحفظ: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء حفظ إعدادات السحابة', 'error');
    }
  },

  async testCloudConnection() {
    const btn = document.getElementById('btnTestCloudConn');
    const resBox = document.getElementById('cloudConnectionTestResult');
    const provider = document.getElementById('cfgCloudProvider')?.value || 'cloud_vault';
    const endpointUrl = document.getElementById('cfgCloudEndpoint')?.value?.trim() || '';
    const authToken = document.getElementById('cfgCloudToken')?.value?.trim() || '';
    const syncedFolder = document.getElementById('cfgCloudFolder')?.value?.trim() || '';

    if (btn) btn.disabled = true;
    if (resBox) {
      resBox.style.display = 'block';
      resBox.style.background = 'rgba(255,255,255,0.05)';
      resBox.style.color = '#94a3b8';
      resBox.textContent = 'جاري اختبار الاتصال واستجابة السحابة... ⏳';
    }

    try {
      const res = await fetch('/api/settings/cloud-backup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, endpointUrl, authToken, syncedFolder })
      });
      const json = await res.json();
      if (resBox) {
        if (json.success) {
          resBox.style.background = 'rgba(16, 185, 129, 0.15)';
          resBox.style.color = '#34d399';
          resBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          resBox.innerHTML = `<strong>✅ ${json.message}</strong>${json.latencyMs ? ` <span style="font-size:0.75rem;">(${json.latencyMs} ms)</span>` : ''}`;
        } else {
          resBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resBox.style.color = '#f87171';
          resBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          resBox.innerHTML = `<strong>❌ ${json.message}</strong>`;
        }
      }
    } catch (e) {
      if (resBox) {
        resBox.style.background = 'rgba(239, 68, 68, 0.15)';
        resBox.style.color = '#f87171';
        resBox.textContent = 'تعذر الاتصال بالخادم لاختبار السحابة: ' + e.message;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async createFullSystemArchive() {
    const btn = document.getElementById('btnCreateArchiveNow');
    const encrypt = Boolean(document.getElementById('cfgArchiveEncrypt')?.checked);
    const passphrase = document.getElementById('cfgArchivePassphrase')?.value?.trim() || '';
    const includeProjectsFiles = Boolean(document.getElementById('cfgArchiveIncludeFiles')?.checked);

    if (encrypt && (!passphrase || passphrase.length < 4)) {
      App.showToast('يرجى إدخال كلمة مرور أو مفتاح أمان لا يقل عن 4 خانات لتشفير الأرشيف', 'warning');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ جاري حزم وتشفير النظام بالكامل...';
    }

    App.showToast('جاري إنشاء الأرشيف الشامل وحزم قاعدة البيانات والمشاريع...', 'info');

    try {
      const res = await fetch('/api/settings/cloud-backup/create-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypt, passphrase, includeProjectsFiles })
      });
      const json = await res.json();

      if (json.success && json.data) {
        App.showToast(json.message, 'success');
        // بدء التنزيل المباشر للأرشيف إلى جهاز المستخدم
        const downloadUrl = `/api/settings/cloud-backup/download/${encodeURIComponent(json.data.fileName)}`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = json.data.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        await this.loadCloudBackupStatus();
      } else {
        App.showToast('فشل إنشاء الأرشيف: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء إنشاء الأرشيف: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📦🔒 إنشاء وتنزيل الأرشيف الشامل فوراً</span>';
      }
    }
  },

  async syncToCloudNow(fileName = null) {
    const btn = document.getElementById('btnQuickCloudSync');
    if (btn) btn.disabled = true;
    App.showToast('جاري رفع ومزامنة الأرشيف إلى السحابة... ☁️', 'info');

    try {
      const res = await fetch('/api/settings/cloud-backup/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message, 'success');
        await this.loadCloudBackupStatus();
      } else {
        App.showToast('تعذر إتمام المزامنة السحابية: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء المزامنة السحابية: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  renderCloudVaultTable() {
    const tbody = document.getElementById('cloudVaultTableBody');
    if (!tbody) return;

    if (!this._cloudVaultItems || this._cloudVaultItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">
            خزنة الأرشيفات السحابية فارغة حالياً. يمكنك إنشاء أول أرشيف شامل ومشفر عبر الزر أعلاه 📦
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this._cloudVaultItems.map(item => {
      const isEnc = item.encrypted;
      const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
      const dateStr = new Date(item.createdAt).toLocaleString('ar-YE');
      const isBundle = item.includeProjectsFiles || item.fileName.includes('bundle');

      const encBadge = isEnc
        ? '<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem;">🔒 مشفر AES-256</span>'
        : '<span style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">🔓 قياسي (غير مشفر)</span>';

      const typeBadge = isBundle
        ? '<span style="color: var(--gold-light); font-weight: 600;">📦 أرشيف نظام شامل</span>'
        : '<span style="color: var(--accent-blue);">🗄️ قاعدة بيانات فقط</span>';

      const cloudBadge = item.cloudSynced
        ? '<span style="color: #38bdf8; display: inline-flex; align-items: center; gap: 4px;">☁️ مرفوع سحابياً</span>'
        : '<span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px;">💻 محلي بالخزنة</span>';

      return `
        <tr>
          <td>
            <div style="font-weight: 600; color: #f8fafc; font-family: monospace; font-size: 0.85rem;">${item.fileName}</div>
            ${item.sha256 ? `<small style="color: var(--text-secondary); font-size: 0.68rem; font-family: monospace;">SHA: ${item.sha256.substring(0, 16)}...</small>` : ''}
          </td>
          <td>${typeBadge}</td>
          <td>${encBadge}</td>
          <td style="font-weight: 600; font-family: monospace;">${sizeMB} MB</td>
          <td>${cloudBadge}</td>
          <td style="font-size: 0.8rem; color: var(--text-secondary);">${dateStr}</td>
          <td style="text-align: center;">
            <div style="display: inline-flex; gap: 6px;">
              <a href="/api/settings/cloud-backup/download/${encodeURIComponent(item.fileName)}" class="btn btn-secondary btn-sm" title="تنزيل الأرشيف إلى جهازك" style="padding: 4px 8px;">
                📥 تنزيل
              </a>
              ${!item.cloudSynced ? `
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.syncToCloudNow('${item.fileName}')" title="رفع إلى السحابة" style="padding: 4px 8px; color: #38bdf8;">
                  ☁️ رفع
                </button>
              ` : ''}
              <button type="button" class="btn btn-primary btn-sm" onclick="Settings.openEncryptedRestoreModal('${item.fileName}')" title="فحص واستعادة هذه النسخة" style="padding: 4px 8px; background: #059669; border-color: #059669;">
                ↩️ استعادة
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  // ================== نافذة استعادة الأرشيف المشفر ==================
  openEncryptedRestoreModal(preselectedFileName = null) {
    this._selectedVaultRestoreFile = null;
    this._selectedVaultArchiveName = preselectedFileName || null;

    const fileInp = document.getElementById('vaultRestoreFileInput');
    if (fileInp) fileInp.value = '';

    const passInp = document.getElementById('vaultRestorePassphrase');
    if (passInp) passInp.value = '';

    const inspectBox = document.getElementById('vaultRestoreInspectionBox');
    if (inspectBox) {
      inspectBox.style.display = 'none';
      inspectBox.innerHTML = '';
    }

    const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
    if (confirmBtn) confirmBtn.disabled = true;

    const dropHeader = document.getElementById('vaultRestoreFileHeader');
    const dropName = document.getElementById('vaultRestoreFileName');

    if (preselectedFileName) {
      if (dropHeader) dropHeader.textContent = 'تم اختيار نسخة من الخزنة السحابية:';
      if (dropName) dropName.innerHTML = `<strong style="color: #38bdf8;">${preselectedFileName}</strong>`;
    } else {
      if (dropHeader) dropHeader.textContent = 'اضغط هنا لاختيار ملف الأرشيف (.rawasi.enc / .zip / .db)';
      if (dropName) dropName.textContent = 'أو اسحب وأفلت الملف هنا مباشرة';
    }

    App.openModal('encryptedRestoreModal');
  },

  handleVaultRestoreFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    this._selectedVaultRestoreFile = file;
    this._selectedVaultArchiveName = null;

    const dropHeader = document.getElementById('vaultRestoreFileHeader');
    const dropName = document.getElementById('vaultRestoreFileName');
    const sizeKB = (file.size / 1024).toFixed(1);

    if (dropHeader) dropHeader.textContent = 'الملف المحدد للاستعادة:';
    if (dropName) dropName.innerHTML = `<strong style="color: var(--gold-light);">${file.name}</strong> (${sizeKB} KB)`;

    const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
    if (confirmBtn) confirmBtn.disabled = true; // يتطلب فحص أولاً

    const inspectBox = document.getElementById('vaultRestoreInspectionBox');
    if (inspectBox) inspectBox.style.display = 'none';

    App.showToast('تم تحديد الملف، يرجى الضغط على "فحص سلامة الأرشيف ومعاينته"', 'info');
  },

  async inspectSelectedArchive() {
    const btn = document.getElementById('btnInspectArchive');
    const inspectBox = document.getElementById('vaultRestoreInspectionBox');
    const passphrase = document.getElementById('vaultRestorePassphrase')?.value?.trim() || '';

    if (!this._selectedVaultRestoreFile && !this._selectedVaultArchiveName) {
      App.showToast('يرجى اختيار ملف أرشيف خارجي أو تحديد نسخة من الخزنة أولاً', 'warning');
      return;
    }

    if (btn) btn.disabled = true;
    if (inspectBox) {
      inspectBox.style.display = 'block';
      inspectBox.style.background = 'rgba(255,255,255,0.05)';
      inspectBox.style.color = '#94a3b8';
      inspectBox.textContent = 'جاري فحص التشفير والنزاهة وقراءة بيان الأرشيف... ⏳';
    }

    try {
      let bodyData = null;
      const headers = {};
      if (passphrase) {
        headers['x-passphrase'] = encodeURIComponent(passphrase);
      }

      if (this._selectedVaultRestoreFile) {
        bodyData = this._selectedVaultRestoreFile;
        headers['Content-Type'] = 'application/octet-stream';
      } else if (this._selectedVaultArchiveName) {
        headers['x-vault-filename'] = this._selectedVaultArchiveName;
      }

      const res = await fetch('/api/settings/cloud-backup/inspect', {
        method: 'POST',
        headers,
        body: bodyData
      });
      const json = await res.json();

      if (json.success && json.data) {
        const d = json.data;
        if (d.requiresPassphrase) {
          inspectBox.style.background = 'rgba(245, 158, 11, 0.15)';
          inspectBox.style.color = '#fbbf24';
          inspectBox.style.border = '1px solid rgba(245, 158, 11, 0.3)';
          inspectBox.innerHTML = `
            <strong>🔒 هذا الأرشيف مشفر بنظام AES-256-GCM</strong>
            <p style="margin: 4px 0 0 0; font-size: 0.8rem;">يرجى كتابة كلمة مرور فك التشفير في الحقل أعلاه ثم إعادة الضغط على زر الفحص.</p>
          `;
          document.getElementById('vaultRestorePassphrase')?.focus();
          return;
        }

        inspectBox.style.background = 'rgba(16, 185, 129, 0.15)';
        inspectBox.style.color = '#34d399';
        inspectBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';

        const m = d.manifest;
        let detailsHtml = '';
        if (m) {
          detailsHtml = `
            <div style="margin-top: 6px; font-size: 0.8rem; color: #f8fafc; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px;">
              <div><strong>تاريخ إنشاء الأرشيف:</strong> ${new Date(m.timestamp).toLocaleString('ar-YE')}</div>
              <div><strong>نوع الحزمة:</strong> ${m.archive_type} | <strong>المشاريع المرفقة:</strong> ${d.projectFilesCount} ملف</div>
              ${m.stats ? `<div><strong>الإحصائيات:</strong> ${m.stats.projectsCount || 0} مشروع | ${m.stats.contractsCount || 0} عقد | ${m.stats.vouchersCount || 0} سند مالي</div>` : ''}
            </div>
          `;
        }

        inspectBox.innerHTML = `
          <div style="font-weight: 700;">✅ الأرشيف سليم وصالح للاستعادة بنجاح!</div>
          <div style="font-size: 0.8rem;">التشفير: ${d.encrypted ? '🔒 مفكوك ومؤكد' : '🔓 غير مشفر'} | قاعدة البيانات متطابقة بنسبة 100%</div>
          ${detailsHtml}
        `;

        const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
        if (confirmBtn) confirmBtn.disabled = false;
        App.showToast('تم فحص سلامة الأرشيف بنجاح وهو جاهز للاستعادة ✅', 'success');
      } else {
        inspectBox.style.background = 'rgba(239, 68, 68, 0.15)';
        inspectBox.style.color = '#f87171';
        inspectBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        inspectBox.innerHTML = `<strong>❌ خطأ أثناء الفحص:</strong> ${json.message}`;
      }
    } catch (err) {
      if (inspectBox) {
        inspectBox.style.background = 'rgba(239, 68, 68, 0.15)';
        inspectBox.style.color = '#f87171';
        inspectBox.innerHTML = `<strong>خطأ في فحص الملف:</strong> ${err.message}`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async executeEncryptedRestore() {
    const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
    const passphrase = document.getElementById('vaultRestorePassphrase')?.value?.trim() || '';
    const restoreFiles = Boolean(document.getElementById('vaultRestoreFilesCheck')?.checked);

    if (!confirm('تحذير نهائي: هل أنت متأكد من استعادة هذا الأرشيف وتحديث بيانات النظام والمشاريع؟\nسيقوم النظام بحفظ نسخة أمان طارئة تلقائياً.')) {
      return;
    }

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '⏳ جاري استعادة النظام وقاعدة البيانات...';
    }

    App.showToast('جاري تنفيذ الاستعادة الشاملة...', 'info');

    try {
      let bodyData = null;
      const headers = {
        'x-restore-files': String(restoreFiles)
      };
      if (passphrase) {
        headers['x-passphrase'] = encodeURIComponent(passphrase);
      }

      if (this._selectedVaultRestoreFile) {
        bodyData = this._selectedVaultRestoreFile;
        headers['Content-Type'] = 'application/octet-stream';
      } else if (this._selectedVaultArchiveName) {
        headers['x-vault-filename'] = this._selectedVaultArchiveName;
      }

      const res = await fetch('/api/settings/cloud-backup/restore', {
        method: 'POST',
        headers,
        body: bodyData
      });
      const json = await res.json();

      if (json.success) {
        App.showToast(json.message, 'success');
        App.closeModal('encryptedRestoreModal');
        setTimeout(() => {
          App.showToast('جاري تحديث واجهة النظام وتنشيط الجداول المحدثة...', 'info');
          setTimeout(() => window.location.reload(), 1500);
        }, 1000);
      } else {
        App.showToast('فشلت الاستعادة: ' + json.message, 'error');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = '<span>🛡️ تأكيد وتنفيذ الاستعادة الشاملة</span>';
        }
      }
    } catch (err) {
      App.showToast('خطأ أثناء تنفيذ الاستعادة: ' + err.message, 'error');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span>🛡️ تأكيد وتنفيذ الاستعادة الشاملة</span>';
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.Settings = Settings;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Settings;
}

