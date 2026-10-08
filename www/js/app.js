/**
 * المنظم الرئيسي للنظام - نظام رواسي عدن للهندسة والمقاولات (SPA Controller)
 */

const App = {
  assetVersion: '1.0.0.20261007-pj6k',
  activeView: 'dashboard',
  dbStatus: null,

  // ============================================================
  // ⚡ سجل مسارات الوحدات للتحميل الكسول عند الطلب (Code Splitting)
  // ============================================================
  _moduleRegistry: {
    tafqeet: 'js/tafqeet.js?v=1.0.0.20261007-pj6k',
    projects: 'js/projects.js?v=1.0.0.20261007-pj6k',
    projectHub: 'js/project_hub.js?v=1.0.0.20261007-pj6k',
    projectControl: 'js/project_control_ui.js?v=1.0.0.20261007-pj6k',
    accounting: 'js/accounting.js?v=1.0.0.20261007-pj6k',
    hr: 'js/hr.js?v=1.0.0.20261007-pj6k',
    reports: 'js/reports.js?v=1.0.0.20261007-pj6k',
    inventory: 'js/inventory.js?v=1.0.0.20261007-pj6k',
    projectCloseout: 'js/project_closeout.js?v=1.0.0.20261007-pj6k',
    settings: 'js/settings.js?v=1.0.0.20261007-pj6k',
    excelExport: 'js/excel-export.js?v=1.0.0.20261007-pj6k',
    contractsCashflow: 'js/contracts_cashflow.js?v=1.0.0.20261007-pj6k'
  },
  _loadedModules: {},
  _loadingPromises: {},

  loadModule(name) {
    if (this._loadedModules[name]) return Promise.resolve();
    if (this._loadingPromises[name]) return this._loadingPromises[name];

    const src = this._moduleRegistry[name];
    if (!src) {
      console.warn(`[ModuleLoader] وحدة غير مسجلة: ${name}`);
      return Promise.resolve();
    }

    const p = new Promise((resolve, reject) => {
      // فحص ما إذا كان السكربت موجوداً مسبقاً في DOM
      const existing = document.querySelector(`script[src*="${name}.js"]`) || 
                       document.querySelector(`script[src*="${src.split('?')[0]}"]`);
      if (existing) {
        this._loadedModules[name] = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        this._loadedModules[name] = true;
        console.log(`⚡ [CodeSplitting] تم تحميل الوحدة بنجاح: ${name}`);
        resolve();
      };
      script.onerror = (err) => {
        console.error(`❌ [CodeSplitting] فشل تحميل الوحدة: ${name}`, err);
        delete this._loadingPromises[name];
        reject(err);
      };
      document.body.appendChild(script);
    });

    this._loadingPromises[name] = p;
    return p;
  },

  async loadModulesForView(viewId) {
    const viewMap = {
      dashboard: ['reports', 'projects'],
      projects: ['projects'],
      projectHub: ['projects', 'projectHub', 'tafqeet', 'accounting'],
      revenues: ['tafqeet', 'accounting'],
      expenses: ['tafqeet', 'accounting'],
      custody: ['tafqeet', 'accounting'],
      journal: ['tafqeet', 'accounting', 'excelExport'],
      chartOfAccounts: ['accounting'],
      costCenters: ['accounting'],
      currencies: ['accounting'],
      clients: ['tafqeet', 'accounting', 'reports'],
      suppliers: ['tafqeet', 'accounting', 'reports'],
      cash: ['tafqeet', 'accounting'],
      reports: ['reports', 'tafqeet', 'accounting', 'excelExport'],
      inventory: ['inventory'],
      projectCloseout: ['projects', 'projectCloseout', 'tafqeet'],
      hr: ['hr'],
      contractLifecycle: ['projects', 'contractsCashflow'],
      cashFlow: ['accounting', 'contractsCashflow'],
      settings: ['settings']
    };

    const modules = viewMap[viewId] || [];
    for (const mod of modules) {
      await this.loadModule(mod);
    }
  },

  // التحميل الكسول المسبق في أوقات خمول المتصفح (Idle Preload)
  prefetchRemainingModules() {
    const allModules = Object.keys(this._moduleRegistry);
    allModules.forEach(mod => {
      if (!this._loadedModules[mod] && !this._loadingPromises[mod]) {
        this.loadModule(mod).catch(() => {});
      }
    });
  },

  async init() {
    console.log('🚀 تهيئة نظام رواسي عدن للهندسة والمقاولات (فائق السرعة والأداء)...');

    // تطبيق المظهر المحفوظ فورياً قبل تحميل أي شيء
    this.initTheme();

    // التحقق المسبق من الاتصال بقاعدة البيانات (أونلاين / أوفلاين)
    await this.checkDatabaseStatus();

    // تهيئة وحدة الأمان والمصادقة الأساسية
    if (typeof Auth !== 'undefined' && Auth.init) {
      await Auth.init();
    }

    // تحميل وتهيئة وحدات لوحة التحكم الرئيسية فقط (Dashboard) لتسريع الإقلاع بنسبة 75%+
    await this.loadModulesForView('dashboard');
    if (typeof Projects !== 'undefined' && Projects.init) {
      await Projects.init();
      Projects._initialized = true;
    }
    if (typeof Reports !== 'undefined' && Reports.init) {
      await Reports.init();
      Reports._initialized = true;
    }

    this.bindEvents();
    this.setupDatePickers();
    this.setupNetworkWatchers();
    this.setupHardwareBackButton();
    this.initAutoBackupHeader();

    // تهيئة مسار التنقل الدلالي ووحدة تجربة المستخدم والتحميل الكسول
    if (window.UI && UI.Breadcrumbs) UI.Breadcrumbs.update(this.activeView);
    if (window.UI && UI.LazyLoader) UI.LazyLoader.init();

    // جدولة تحميل باقي الوحدات في خلفية خمول المتصفح لضمان استجابة فورية لأي نقرة قادمة
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => this.prefetchRemainingModules());
    } else {
      setTimeout(() => this.prefetchRemainingModules(), 1800);
    }

    console.log('✅ تم تشغيل نظام رواسي عدن بنجاح بأعلى كفاءة!');
  },

  bindEvents() {
    // إغلاق النوافذ المنبثقة بالنقر على الخلفية بالتفويض الشامل (Event Delegation)
    document.addEventListener('click', (e) => {
      if (e.target && (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal'))) {
        this.closeModal(e.target.id);
      }
    });

    // إغلاق النوافذ بمفتاح Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.handleDismissOrBack();
      }
    });

    // إغلاق قائمة الإشعارات المنسدلة عند النقر خارجها
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('notificationsWrapper');
      const dropdown = document.getElementById('notificationsDropdown');
      if (dropdown && dropdown.classList.contains('active') && wrapper && !wrapper.contains(e.target)) {
        dropdown.classList.remove('active');
      }

      // إغلاق قائمة حالة النسخ الاحتياطي التلقائي عند النقر خارجها
      const backupWrap = document.getElementById('headerBackupStatusWrap');
      const backupDropdown = document.getElementById('backupStatusDropdown');
      if (backupDropdown && backupDropdown.classList.contains('active') && backupWrap && !backupWrap.contains(e.target)) {
        backupDropdown.classList.remove('active');
      }
    });

        // إغلاق القائمة الجانبية تلقائياً عند النقر على أي رابط داخلها على الهواتف والأجهزة اللوحية
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.sidebar-nav a, .nav-sub-item');
      if (link && window.innerWidth <= 1024) {
        this.closeMobileSidebar();
      }
    });

    // استجابة تغيير حجم النافذة للرسوم البيانية
    window.addEventListener('resize', () => {
      if (this.activeView === 'dashboard') {
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
          Reports.loadDashboardKPIs();
        }
      }
    });
  },

  setupDatePickers() {
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = ['rcDate', 'expDate', 'custodyDate', 'plToDate'];
    dateInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = today;
    });

    const fromInput = document.getElementById('plFromDate');
    if (fromInput && !fromInput.value) fromInput.value = '2024-01-01';
  },

  // التحكم بالقائمة الجانبية للشاشات الصغيرة والهواتف
  toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) {
      const isOpen = sidebar.classList.toggle('mobile-open');
      if (backdrop) backdrop.classList.toggle('active', isOpen);
      if (window.innerWidth <= 1024) {
        document.body.style.overflow = isOpen ? 'hidden' : '';
      }
    }
  },

  closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
  },

  setupHardwareBackButton() {
    // 1. دعم زر الرجوع الفعلي لأجهزة أندرويد عبر Capacitor
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        const handled = this.handleDismissOrBack();
        if (!handled) {
          if (this.activeView !== 'dashboard') {
            this.navigate('dashboard');
          } else {
            window.Capacitor.Plugins.App.exitApp();
          }
        }
      });
    }

    // 2. زر Escape في لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        this.handleDismissOrBack();
      }
    });

    // 3. سجل تصفح المتصفح (PopState)
    window.addEventListener('popstate', () => {
      this.handleDismissOrBack();
    });
  },

  handleDismissOrBack() {
    // إغلاق أي نافذة منبثقة مفتوحة
    const activeModals = document.querySelectorAll('.modal-overlay.active, .modal.active');
    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      topModal.classList.remove('active');
      const remaining = document.querySelectorAll('.modal-overlay.active, .modal.active');
      if (remaining.length === 0) {
        document.body.style.overflow = '';
      }
      return true;
    }

    // إغلاق القائمة الجانبية إذا كانت مفتوحة
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
      this.closeMobileSidebar();
      return true;
    }

    // إغلاق قائمة الإشعارات إذا كانت مفتوحة
    const dropdown = document.getElementById('notificationsDropdown');
    if (dropdown && dropdown.classList.contains('active')) {
      dropdown.classList.remove('active');
      return true;
    }

    return false;
  },

  // ============================================
  // 🌙☀️ تبديل الوضع الليلي / النهاري
  // ============================================
  initTheme() {
    // استرجاع الوضع المحفوظ من localStorage
    const savedTheme = localStorage.getItem('rawasi_theme') || 'dark';
    this.applyTheme(savedTheme);
  },

  toggleTheme() {
    const isLight = document.body.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    localStorage.setItem('rawasi_theme', newTheme);
    this.applyTheme(newTheme);

    // تلميح مرئي للمستخدم
    const label = newTheme === 'light' ? 'نهاري' : 'ليلي';
    this.showToast(`تم التبديل إلى الوضع ${label} ✨`, 'info');
  },

  applyTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-mode', isLight);
    document.documentElement.classList.toggle('light-mode', isLight);

    // تحديث نص وأيقونة زر التبديل
    const label = document.getElementById('themeToggleLabel');
    if (label) label.textContent = isLight ? 'نهاري' : 'ليلي';

    // تحديث meta theme-color للمتصفح
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isLight ? '#16304f' : '#0f172a');
  },

  // التحكم بالقوائم الشجرية المنسدلة (Accordion Groups)
  toggleNavGroup(groupId) {
    const groupEl = document.getElementById(groupId);
    if (!groupEl) return;
    const isOpen = groupEl.classList.contains('open');
    groupEl.classList.toggle('open', !isOpen);
  },

  // التنقل الشجري العميق إلى إدارة وتبويب محدد
  async navigateDeep(viewId, subTab, clickedEl = null) {
    // فتح مجموعة القائمة الحاضنة للتبويب
    if (clickedEl) {
      const parentGroup = clickedEl.closest('.nav-group');
      if (parentGroup) parentGroup.classList.add('open');
      document.querySelectorAll('.nav-sub-item').forEach(el => el.classList.remove('active'));
      clickedEl.classList.add('active');
    }

    // الانتقال للشاشة الرئيسية أولاً وتحميل حزمتها البرمجية
    await this.navigate(viewId, null);

    // تحديث مسار التنقل الدلالي ليشمل التبويب المتخصص
    if (window.UI && UI.Breadcrumbs) {
      UI.Breadcrumbs.update(viewId, subTab);
    }

    // توجيه التبويب الفرعي المتخصص
    if (viewId === 'settings') {
      if (typeof Settings !== 'undefined' && Settings.switchTab) {
        Settings.switchTab(subTab);
      }
    } else if (viewId === 'journal') {
      if (typeof Accounting !== 'undefined' && Accounting.switchJournalTab) {
        Accounting.switchJournalTab(subTab);
      }
    } else if (viewId === 'reports') {
      if (typeof Reports !== 'undefined' && Reports.switchReportTab) {
        Reports.switchReportTab(subTab);
      }
    } else if (viewId === 'hr') {
      if (typeof HR !== 'undefined' && HR.showPane) {
        const btn = document.querySelector(`#hrView .report-tab-btn[onclick*="'${subTab}'"]`);
        HR.showPane(subTab, btn);
      }
    } else if (viewId === 'projects') {
      if (typeof Projects !== 'undefined' && Projects.filterStatus) {
        Projects.filterStatus(subTab);
      }
    } else if (viewId === 'inventory') {
      if (typeof Inventory !== 'undefined' && Inventory.switchTab) {
        Inventory.switchTab(subTab);
      }
    }
  },

  // التنقل السريع إلى قسم محدد داخل مركز مستندات المشروع الـ 16
  async navigateProjectHubSection(sectionNumber) {
    await this.navigate('projectHub');
    if (typeof ProjectHub !== 'undefined') {
      if (ProjectHub.switchSection) {
        ProjectHub.switchSection(sectionNumber);
      } else if (ProjectHub.showSection) {
        ProjectHub.showSection(sectionNumber);
      }
    }
  },

  // التنقل بين الأقسام والشاشات مع التحميل عند الطلب (Code Splitting)
  async navigate(viewId, clickedEl = null) {
    // التحقق الأمني من صلاحية المستخدم للوصول للشاشة لمنع أي تلاعب عبر الـ DOM أو الكونسول
    if (typeof Auth !== 'undefined' && typeof Auth.canAccessView === 'function') {
      if (!Auth.canAccessView(viewId)) {
        console.warn(`[Security] تم رفض الوصول للشاشة: ${viewId} لعدم كفاية الصلاحيات.`);
        if (typeof this.showToast === 'function') {
          this.showToast('⛔ عذراً، لا تملك الصلاحية الكافية للوصول إلى هذا القسم.', 'error');
        }
        return false;
      }
    }

    // تحميل الوحدات المطلوبة للشاشة المستهدفة كودياً عند الطلب
    await this.loadModulesForView(viewId);

    // تهيئة الوحدة في حال لم يتم تهيئتها بعد
    if (viewId === 'projects' && typeof Projects !== 'undefined' && !Projects._initialized && Projects.init) {
      await Projects.init();
      Projects._initialized = true;
    } else if (viewId === 'projectHub' && typeof ProjectHub !== 'undefined' && !ProjectHub._initialized && ProjectHub.init) {
      await ProjectHub.init();
      ProjectHub._initialized = true;
    } else if (['revenues', 'expenses', 'custody', 'journal', 'chartOfAccounts', 'costCenters', 'currencies', 'cash'].includes(viewId)) {
      if (typeof Accounting !== 'undefined' && !Accounting._initialized && Accounting.init) {
        await Accounting.init();
        Accounting._initialized = true;
      }
    } else if (viewId === 'inventory' && typeof Inventory !== 'undefined' && !Inventory._initialized && Inventory.init) {
      await Inventory.init();
      Inventory._initialized = true;
    } else if (viewId === 'projectCloseout' && typeof ProjectCloseout !== 'undefined' && !ProjectCloseout._initialized && ProjectCloseout.init) {
      await ProjectCloseout.init();
      ProjectCloseout._initialized = true;
    } else if (viewId === 'hr' && typeof HR !== 'undefined' && !HR._initialized && HR.init) {
      HR.init();
      HR._initialized = true;
    } else if (viewId === 'settings' && typeof Settings !== 'undefined' && !Settings._initialized && Settings.init) {
      await Settings.init();
      Settings._initialized = true;
    } else if (viewId === 'reports' && typeof Reports !== 'undefined' && !Reports._initialized && Reports.init) {
      await Reports.init();
      Reports._initialized = true;
    } else if (viewId === 'contractLifecycle' && window.ContractAlertsUI && !window.ContractAlertsUI._initialized) {
      await window.ContractAlertsUI.init();
      window.ContractAlertsUI._initialized = true;
    } else if (viewId === 'cashFlow' && window.CashFlowUI && !window.CashFlowUI._initialized) {
      await window.CashFlowUI.init();
      window.CashFlowUI._initialized = true;
    }

    this.activeView = viewId;
    this.closeMobileSidebar();

    // تحديث مسار التنقل الدلالي تلقائياً
    if (window.UI && UI.Breadcrumbs) {
      UI.Breadcrumbs.update(viewId);
    }

    // تحديث رابط القائمة الجانبية النشط
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    if (clickedEl && clickedEl.classList.contains('nav-item')) {
      clickedEl.classList.add('active');
    } else {
      // مطابقة العنصر في القائمة الجانبية تلقائياً
      const matchedNavItem = document.querySelector(`.nav-item[onclick*="'${viewId}'"]`);
      if (matchedNavItem) matchedNavItem.classList.add('active');
    }

    // تحديث أزرار شريط التنقل السفلي للهواتف
    const accountingViews = ['journal', 'revenues', 'expenses', 'custody', 'chartOfAccounts', 'costCenters', 'currencies', 'cash'];
    const projectViews = ['projects', 'projectHub'];

    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      const navTarget = btn.getAttribute('data-nav');
      if (!navTarget) return;

      let isMatch = (navTarget === viewId);
      if (navTarget === 'projects' && projectViews.includes(viewId)) isMatch = true;
      if (navTarget === 'journal' && accountingViews.includes(viewId)) isMatch = true;

      if (isMatch) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // إخفاء كافة الشاشات وإظهار الشاشة المطلوبة
    const views = document.querySelectorAll('.app-view-section');
    views.forEach(v => v.style.display = 'none');

    const targetView = document.getElementById(viewId + 'View');
    if (targetView) {
      targetView.style.display = 'block';
    } else {
      // إذا كانت شاشة افتراضية ترجع إلى لوحة التحكم
      const dash = document.getElementById('dashboardView');
      if (dash) dash.style.display = 'block';
    }

    // تمرير الشاشة للأعلى بسلاسة
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // تحديث المحتوى وفق الشاشة
    if (viewId === 'dashboard') {
      if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
        Reports.loadDashboardKPIs();
      }
      if (typeof Projects !== 'undefined' && Projects.loadProjects) {
        Projects.loadProjects();
      }
    } else if (viewId === 'reports') {
      if (typeof Reports !== 'undefined' && Reports.switchReportTab) {
        Reports.switchReportTab(Reports.activeReportTab || 'profit-loss');
      }
    } else if (viewId === 'hr') {
      HR.load();
    } else if (viewId === 'projects') {
      Projects.loadProjects();
    } else if (viewId === 'projectHub') {
      if (typeof ProjectHub !== 'undefined') {
        ProjectHub.populateProjectSelect().then(() => ProjectHub.loadProjectData());
      }
    } else if (viewId === 'inventory') {
      Inventory.loadItems();
    } else if (viewId === 'revenues') {
      this.loadRevenuesTable();
    } else if (viewId === 'expenses') {
      this.loadExpensesTable();
    } else if (viewId === 'custody') {
      Accounting.loadRecentCustodySummary();
      this.loadCustodyTable();
    } else if (viewId === 'journal') {
      Accounting.loadJournalEntries();
    } else if (viewId === 'chartOfAccounts') {
      Accounting.loadAccounts();
    } else if (viewId === 'costCenters') {
      Accounting.loadCostCenters();
    } else if (viewId === 'currencies') {
      Accounting.loadCurrencies();
    } else if (viewId === 'clients') {
      this.loadClientsTable();
    } else if (viewId === 'suppliers') {
      this.loadSuppliersTable();
    } else if (viewId === 'cash') {
      Accounting.loadCashMovement();
      this.loadCashTable();
    } else if (viewId === 'settings') {
      Settings.loadCompanySettings();
      Settings.loadUsers();
    } else if (viewId === 'contractLifecycle') {
      if (window.ContractAlertsUI && window.ContractAlertsUI.loadDashboard) {
        window.ContractAlertsUI.loadDashboard();
      }
    } else if (viewId === 'cashFlow') {
      if (window.CashFlowUI && window.CashFlowUI.loadProjections) {
        window.CashFlowUI.loadProjections();
      }
    }
  },

  async loadRevenuesTable() {
    const tbody = document.getElementById('fullRevenuesTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 10);
    }

    try {
      const res = await fetch('/api/payments?type=قبض');
      const json = await res.json();
      if (json.success) {
        const list = json.data || [];
        const total = list.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const kpiTotal = document.getElementById('revKpiTotal');
        const kpiCount = document.getElementById('revKpiCount');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(total);
        if (kpiCount) kpiCount.textContent = list.length;

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد سندات قبض مسجلة حتى الآن</td></tr>`;
            const pag = document.getElementById('revenuesPagination');
            if (pag) pag.innerHTML = '';
          } else {
            const renderSingleRow = (p) => {
              const accStr = p.account_code ? `${p.account_code} - ${p.account_name}` : (p.account_name || '-');
              const ccStr = p.cost_center_code ? `${p.cost_center_code} - ${p.cost_center_name}` : (p.cost_center_name || '-');
              const paymentStr = p.payment_method === 'شيك' 
                ? `<span class="badge badge-active" style="background: rgba(212, 175, 55, 0.2); color: var(--gold-light); border: 1px solid var(--gold-light);">شيك: ${p.check_no || 'غير محدد'}</span>`
                : `<span class="badge badge-active">${p.payment_method}</span>`;

              return `
                <tr>
                  <td><strong style="color: var(--gold-light); font-family: monospace;">${p.receipt_no}</strong></td>
                  <td>${p.date}</td>
                  <td><strong>${p.client_name || '-'}</strong></td>
                  <td><span style="font-size: 0.82rem; color: #94a3b8;">${accStr}</span></td>
                  <td><span style="font-size: 0.82rem; color: #38bdf8;">${ccStr}</span></td>
                  <td>${p.project_name || '-'}</td>
                  <td style="color: var(--accent-green); font-weight: bold;">${this.formatNumber(p.amount)} ${p.currency || 'ر.ي'}</td>
                  <td>${paymentStr}</td>
                  <td>${p.notes || '-'}</td>
                  <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm" onclick="Accounting.printReceipt({
                      receipt_no: '${p.receipt_no}',
                      date: '${p.date}',
                      client_name: '${(p.client_name || 'العميل').replace(/'/g, "\\'")}',
                      account_code: '${p.account_code || ''}',
                      account_name: '${(p.account_name || '').replace(/'/g, "\\'")}',
                      cost_center_code: '${p.cost_center_code || ''}',
                      cost_center_name: '${(p.cost_center_name || '').replace(/'/g, "\\'")}',
                      project_name: '${(p.project_name || '-').replace(/'/g, "\\'")}',
                      amount: ${p.amount},
                      currency: '${p.currency || 'ر.ي'}',
                      payment_method: '${p.payment_method}',
                      check_no: '${(p.check_no || '').replace(/'/g, "\\'")}',
                      bank_name: '${(p.bank_name || '').replace(/'/g, "\\'")}',
                      notes: '${(p.notes || '').replace(/'/g, "\\'")}'
                    })">
                      <svg class="icon"><use href="#icon-print"></use></svg>
                      <span>طباعة</span>
                    </button>
                  </td>
                </tr>
              `;
            };

            const renderRows = (pageList) => {
              if (pageList.length > 30 && window.UI && UI.VirtualTable) {
                UI.VirtualTable.attach({
                  tableBodyId: 'fullRevenuesTableBody',
                  data: pageList,
                  rowHeight: 46,
                  renderRow: renderSingleRow
                });
              } else {
                tbody.innerHTML = pageList.map(renderSingleRow).join('');
              }
            };

            if (window.UI && UI.Pagination && document.getElementById('revenuesPagination')) {
              UI.Pagination.create({
                containerId: 'revenuesPagination',
                data: list,
                pageSize: 15,
                onPageChange: (pageData) => renderRows(pageData)
              });
            } else {
              renderRows(list);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading revenues:', e);
    }
  },

  async loadExpensesTable() {
    const tbody = document.getElementById('fullExpensesTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 10);
    }

    try {
      const res = await fetch('/api/expenses');
      const json = await res.json();
      if (json.success) {
        const list = json.data || [];
        const total = list.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const kpiTotal = document.getElementById('expKpiTotal');
        const kpiCount = document.getElementById('expKpiCount');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(total);
        if (kpiCount) kpiCount.textContent = list.length;

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد سندات صرف مسجلة حتى الآن</td></tr>`;
            const pag = document.getElementById('expensesPagination');
            if (pag) pag.innerHTML = '';
          } else {
            const renderSingleRow = (e) => {
              const accStr = e.account_code ? `${e.account_code} - ${e.account_name}` : (e.account_name || '-');
              const ccStr = e.cost_center_code ? `${e.cost_center_code} - ${e.cost_center_name}` : (e.cost_center_name || '-');
              const paymentStr = e.payment_method === 'شيك' 
                ? `<span class="badge badge-active" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);">شيك: ${e.check_no || 'غير محدد'}</span>`
                : `<span class="badge badge-active">${e.payment_method}</span>`;

              return `
                <tr>
                  <td><strong style="color: var(--accent-red); font-family: monospace;">${e.receipt_no}</strong></td>
                  <td>${e.date}</td>
                  <td><span class="badge badge-expense">${e.expense_type}</span></td>
                  <td><span style="font-size: 0.82rem; color: #94a3b8;">${accStr}</span></td>
                  <td><span style="font-size: 0.82rem; color: #38bdf8;">${ccStr}</span></td>
                  <td>${e.project_name || '-'}</td>
                  <td><strong>${e.supplier_name || '-'}</strong></td>
                  <td style="color: var(--accent-red); font-weight: bold;">${this.formatNumber(e.amount)} ${e.currency || 'ر.ي'}</td>
                  <td>${paymentStr}</td>
                  <td>${e.notes || '-'}</td>
                  <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm" onclick="Accounting.printExpenseReceipt({
                      receipt_no: '${e.receipt_no}',
                      date: '${e.date}',
                      expense_type: '${(e.expense_type || '').replace(/'/g, "\\'")}',
                      account_code: '${e.account_code || ''}',
                      account_name: '${(e.account_name || '').replace(/'/g, "\\'")}',
                      cost_center_code: '${e.cost_center_code || ''}',
                      cost_center_name: '${(e.cost_center_name || '').replace(/'/g, "\\'")}',
                      supplier_name: '${(e.supplier_name || '-').replace(/'/g, "\\'")}',
                      project_name: '${(e.project_name || '-').replace(/'/g, "\\'")}',
                      amount: ${e.amount},
                      currency: '${e.currency || 'ر.ي'}',
                      payment_method: '${e.payment_method}',
                      check_no: '${(e.check_no || '').replace(/'/g, "\\'")}',
                      bank_name: '${(e.bank_name || '').replace(/'/g, "\\'")}',
                      notes: '${(e.notes || '').replace(/'/g, "\\'")}'
                    })">
                      <svg class="icon"><use href="#icon-print"></use></svg>
                      <span>طباعة</span>
                    </button>
                  </td>
                </tr>
              `;
            };

            const renderRows = (pageList) => {
              if (pageList.length > 30 && window.UI && UI.VirtualTable) {
                UI.VirtualTable.attach({
                  tableBodyId: 'fullExpensesTableBody',
                  data: pageList,
                  rowHeight: 46,
                  renderRow: renderSingleRow
                });
              } else {
                tbody.innerHTML = pageList.map(renderSingleRow).join('');
              }
            };

            if (window.UI && UI.Pagination && document.getElementById('expensesPagination')) {
              UI.Pagination.create({
                containerId: 'expensesPagination',
                data: list,
                pageSize: 15,
                onPageChange: (pageData) => renderRows(pageData)
              });
            } else {
              renderRows(list);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading expenses:', e);
    }
  },

  async loadCustodyTable() {
    const tbody = document.getElementById('fullCustodyTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 9);
    }

    try {
      const res = await fetch('/api/accounting/custodies');
      const json = await res.json();
      if (json.success) {
        const list = json.data || [];
        const totalAmount = list.reduce((sum, c) => sum + (Number(c.total_amount) || 0), 0);
        const totalSpent = list.reduce((sum, c) => sum + (Number(c.spent_amount) || 0), 0);
        const totalRemaining = list.reduce((sum, c) => sum + (Number(c.remaining_amount) || 0), 0);

        const kpiTotal = document.getElementById('custodyKpiTotal');
        const kpiSpent = document.getElementById('custodyKpiSpent');
        const kpiRemain = document.getElementById('custodyKpiRemaining');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(totalAmount);
        if (kpiSpent) kpiSpent.textContent = this.formatNumber(totalSpent);
        if (kpiRemain) kpiRemain.textContent = this.formatNumber(totalRemaining);

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد حركات عهد مسجلة</td></tr>`;
            const pag = document.getElementById('custodyPagination');
            if (pag) pag.innerHTML = '';
          } else {
            const renderRows = (pageList) => {
              tbody.innerHTML = pageList.map(c => {
                const empDisplay = `<strong>${c.employee_name}</strong>${c.employee_no ? `<br><small style="color: var(--gold-light); font-family: monospace; font-weight: bold;">(الرقم: ${c.employee_no})</small>` : ''}`;
                const accDisplay = c.account_name 
                  ? `<strong>${c.account_name}</strong>${c.account_code ? `<br><small style="font-family: monospace; color: #38bdf8; font-weight: bold;">(${c.account_code})</small>` : ''}`
                  : `<span style="color: var(--text-secondary); font-size: 0.82rem;">-</span>`;
                const origCustodyDisplay = c.related_custody_no 
                  ? `<span style="color: #38bdf8; font-weight: bold; font-family: monospace;">تصفية لـ: ${c.related_custody_no}</span>`
                  : `<span style="color: var(--text-secondary);">-</span>`;

                return `
                  <tr>
                    <td>${c.date}</td>
                    <td>${empDisplay}</td>
                    <td>${accDisplay}</td>
                    <td>
                      <span class="badge ${c.operation_type === 'تصفية عهدة' ? 'badge-income' : 'badge-active'}">${c.operation_type}</span>
                      ${c.custody_no ? `<br><small style="font-family: monospace; color: var(--gold-light); font-weight: bold;">${c.custody_no}</small>` : ''}
                    </td>
                    <td>${origCustodyDisplay}</td>
                    <td>${this.formatNumber(c.total_amount)} ${c.currency || 'ر.ي'}</td>
                    <td style="color: var(--accent-red); font-weight: bold;">${this.formatNumber(c.spent_amount)} ${c.currency || 'ر.ي'}</td>
                    <td style="color: var(--accent-green); font-weight: bold;">${this.formatNumber(c.remaining_amount)} ${c.currency || 'ر.ي'}</td>
                    <td>${c.notes || '-'}</td>
                    <td style="text-align: center; white-space: nowrap;">
                      <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: center;">
                        ${c.operation_type === 'صرف عهدة' && Number(c.remaining_amount) > 0 ? `
                          <button class="btn btn-sm btn-primary" title="تصفية هذه العهدة بحسب عملية الصرف" onclick="Accounting.openSettleCustodyModal(${c.id}, '${c.custody_no || ('CST-' + c.id)}', '${(c.employee_name || '').replace(/'/g, "\\'")}', ${c.employee_id || 'null'}, ${c.remaining_amount}, '${c.currency || 'ر.ي'}')">
                            ⚖️ تصفية
                          </button>
                        ` : (c.operation_type === 'تصفية عهدة' ? `<span class="badge badge-income">مصفاة</span>` : `<span class="badge badge-inactive">مسددة</span>`)}
                        <button class="btn btn-sm btn-secondary" title="طباعة سند العهدة / التصفية" onclick="Accounting.printCustodyReceipt({
                          id: ${c.id},
                          custody_no: '${c.custody_no || ('CST-' + c.id)}',
                          date: '${c.date}',
                          operation_type: '${c.operation_type || 'صرف عهدة'}',
                          employee_name: '${(c.employee_name || '').replace(/'/g, "\\'")}',
                          employee_no: '${(c.employee_no || '').replace(/'/g, "\\'")}',
                          related_custody_id: ${c.related_custody_id || 'null'},
                          related_custody_no: '${(c.related_custody_no || '').replace(/'/g, "\\'")}',
                          total_amount: ${c.total_amount || 0},
                          spent_amount: ${c.spent_amount || 0},
                          remaining_amount: ${c.remaining_amount || 0},
                          currency: '${c.currency || 'ر.ي'}',
                          notes: '${(c.notes || '').replace(/'/g, "\\'")}'
                        })">
                          🖨️ طباعة
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('');
            };

            if (window.UI && UI.Pagination && document.getElementById('custodyPagination')) {
              UI.Pagination.create({
                containerId: 'custodyPagination',
                data: list,
                pageSize: 15,
                onPageChange: (pageData) => renderRows(pageData)
              });
            } else {
              renderRows(list);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading custodies:', e);
    }
  },

  async loadClientsTable() {
    const tbody = document.getElementById('fullClientsTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 8);
    }

    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      if (tbody && json.success) {
        const list = json.data || [];
        this.clientsFullList = list;

        // احتساب وعرض بطاقات المؤشرات المالية التراكمية للعملاء
        let totalContractVal = 0;
        let totalContractsCount = 0;
        let totalInvoiced = 0;
        let totalBillsCount = 0;
        let totalCollected = 0;
        let totalRetention = 0;
        let totalDue = 0;

        list.forEach(c => {
          totalContractVal += Number(c.total_contract_value || 0);
          totalContractsCount += Number(c.contract_count || 0);
          totalInvoiced += Number(c.net_invoiced_claims !== undefined ? c.net_invoiced_claims : (c.total_due || 0));
          totalBillsCount += Number(c.bills_count || 0);
          totalCollected += Number(c.total_collections !== undefined ? c.total_collections : (c.total_paid || 0));
          totalRetention += Number(c.active_retention_balance || 0);
          totalDue += Number(c.outstanding_due_balance !== undefined ? c.outstanding_due_balance : (c.current_balance || 0));
        });

        const setTxt = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.innerText = val;
        };

        setTxt('kpiClientsTotalContracts', `${this.formatNumber(totalContractVal)} ر.ي`);
        setTxt('kpiClientsContractsCount', `${totalContractsCount} عقد معتمد`);
        setTxt('kpiClientsTotalInvoiced', `${this.formatNumber(totalInvoiced)} ر.ي`);
        setTxt('kpiClientsBillsCount', `${totalBillsCount} مستخلص ومطالبة`);
        setTxt('kpiClientsTotalCollected', `${this.formatNumber(totalCollected)} ر.ي`);
        setTxt('kpiClientsTotalRetention', `${this.formatNumber(totalRetention)} ر.ي`);
        setTxt('kpiClientsOutstandingDue', `${this.formatNumber(totalDue)} ر.ي`);

        if (list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا يوجد عملاء مسجلين حتى الآن</td></tr>`;
          const pag = document.getElementById('clientsPagination');
          if (pag) pag.innerHTML = '';
        } else {
          const renderRows = (pageList) => {
            tbody.innerHTML = pageList.map(c => {
              const contractCount = Number(c.contract_count || 0);
              const projectCount = Number(c.project_count || 0);
              const billsCount = Number(c.bills_count || 0);
              const invoicedAmt = Number(c.net_invoiced_claims !== undefined ? c.net_invoiced_claims : (c.total_due || 0));
              const collectedAmt = Number(c.total_collections !== undefined ? c.total_collections : (c.total_paid || 0));
              const retentionAmt = Number(c.active_retention_balance || 0);
              const dueBalance = Number(c.outstanding_due_balance !== undefined ? c.outstanding_due_balance : (c.current_balance || 0));
              const curr = c.currency || 'ر.ي';

              const dueColor = dueBalance > 0 ? 'var(--accent-red)' : (dueBalance < 0 ? 'var(--accent-green)' : 'var(--text-secondary)');

              return `
                <tr>
                  <td>
                    <div style="font-weight: 700; color: #fff;">${c.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${c.company || 'عميل فردي'}</div>
                  </td>
                  <td>
                    <div>${c.phone || '-'}</div>
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">${c.address || '-'}</div>
                  </td>
                  <td style="text-align: center;">
                    <div style="display: flex; justify-content: center; gap: 4px; flex-wrap: wrap;">
                      <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;" title="عدد العقود المعتمدة">${contractCount} عقود</span>
                      <span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #a78bfa;" title="المشاريع المرتبطة">${projectCount} مشاريع</span>
                      <span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #facc15;" title="المستخلصات والمطالبات">${billsCount} مستخلص</span>
                    </div>
                  </td>
                  <td>
                    <div style="font-weight: 600; color: var(--gold-light);">${this.formatNumber(invoicedAmt)} ${curr}</div>
                    ${c.gross_work_completed ? `<div style="font-size: 0.7rem; color: var(--text-secondary);">إجمالي الإنجاز: ${this.formatNumber(c.gross_work_completed)}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-weight: 600; color: var(--accent-green);">${this.formatNumber(collectedAmt)} ${curr}</div>
                    ${c.total_advance_received ? `<div style="font-size: 0.7rem; color: var(--text-secondary);">مقدم مقبوض: ${this.formatNumber(c.total_advance_received)}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-weight: 600; color: #f59e0b;">${this.formatNumber(retentionAmt)} ${curr}</div>
                    ${c.total_retention_held ? `<div style="font-size: 0.7rem; color: var(--text-secondary);">إجمالي المحتجز: ${this.formatNumber(c.total_retention_held)}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-weight: 800; font-size: 1rem; color: ${dueColor};">${this.formatNumber(dueBalance)} ${curr}</div>
                    <div style="font-size: 0.68rem; color: var(--text-secondary);">رصيد لحظي مدقق</div>
                  </td>
                  <td style="text-align: center;">
                    <div style="display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap;">
                      <button class="btn btn-primary btn-sm" onclick="App.openClientChainModal(${c.id})" title="استعراض دورة حياة وسلسلة العميل المالية التفاعلية" style="padding: 4px 8px; font-size: 0.75rem;">
                        <span>🔗 السلسلة الشاملة</span>
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="App.navigate('reports'); Reports.switchReportTab('client-statement'); document.getElementById('repClientSelect').value = ${c.id}; Reports.fetchFullClientStatement();" title="كشف الحساب التفصيلي" style="padding: 4px 8px; font-size: 0.75rem;">
                        <span>كشف الحساب</span>
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="App.syncClientBalance(${c.id})" title="مزامنة وتدقيق رصيد العميل لحظياً" style="padding: 4px 6px;">
                        <span>🔄</span>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('');
          };

          if (window.UI && UI.Pagination && document.getElementById('clientsPagination')) {
            UI.Pagination.create({
              containerId: 'clientsPagination',
              data: list,
              pageSize: 15,
              onPageChange: (pageData) => renderRows(pageData)
            });
          } else {
            renderRows(list);
          }
        }
      }
    } catch (e) {
      console.error('Error loading clients table:', e);
    }
  },

  filterClientsTable(searchTerm) {
    if (!this.clientsFullList) return;
    const term = (searchTerm || '').trim().toLowerCase();
    const tbody = document.getElementById('fullClientsTableBody');
    if (!tbody) return;

    if (!term) {
      this.loadClientsTable();
      return;
    }

    const filtered = this.clientsFullList.filter(c => {
      return (c.name && c.name.toLowerCase().includes(term)) ||
             (c.company && c.company.toLowerCase().includes(term)) ||
             (c.phone && c.phone.includes(term)) ||
             (c.address && c.address.toLowerCase().includes(term));
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد نتائج مطابقة لبحثك</td></tr>`;
      return;
    }

    // إعادة رسم الصفوف المفلترة
    if (window.UI && UI.Pagination && document.getElementById('clientsPagination')) {
      UI.Pagination.create({
        containerId: 'clientsPagination',
        data: filtered,
        pageSize: 15,
        onPageChange: (pageData) => {
          // نفس منطق العرض
          this.loadClientsTable();
        }
      });
    }
  },

  async loadSuppliersTable() {
    const tbody = document.getElementById('fullSuppliersTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 7);
    }

    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      if (tbody && json.success) {
        const list = json.data || [];
        if (list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا يوجد موردين مسجلين</td></tr>`;
          const pag = document.getElementById('suppliersPagination');
          if (pag) pag.innerHTML = '';
        } else {
          const renderRows = (pageList) => {
            tbody.innerHTML = pageList.map(s => {
              const fin = s.financial_summary || {};
              const balance = fin.outstanding_balance !== undefined ? fin.outstanding_balance : (s.balance || 0);
              
              // حساب عدد الفواتير بدقة (تشمل فواتير المشتريات والمرفقات)
              let invCount = fin.total_purchase_invoices_count;
              if (invCount === undefined || invCount === 0) {
                if (s.invoice_attachment) {
                  try {
                    const parsed = typeof s.invoice_attachment === 'string' ? JSON.parse(s.invoice_attachment) : s.invoice_attachment;
                    invCount = Array.isArray(parsed) ? parsed.length : 1;
                  } catch (e) {
                    invCount = 1;
                  }
                } else {
                  invCount = 0;
                }
              }

              const totalPaid = fin.total_amount_paid !== undefined ? this.formatNumber(fin.total_amount_paid) : '0';
              const catBadge = s.industry_category || s.category || 'عام';
              const phone = s.phone_number || s.phone || '-';
              const currency = s.default_currency || s.currency || 'ر.ي';
              const contact = s.contact_person ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;"><i class="fa fa-user" style="font-size: 0.7rem; margin-left: 3px;"></i>${s.contact_person}</div>` : '';
              const leadTime = s.supply_lead_time_days ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;"><i class="fa fa-clock" style="font-size: 0.7rem;"></i> توريد: ${s.supply_lead_time_days} أيام</div>` : '';

              const invBadgeText = invCount === 1 ? '1 فاتورة' : `${invCount} فواتير`;

              return `
              <tr>
                <td>
                  <strong style="color: var(--text-primary);">${s.company_name || s.name}</strong>
                  ${contact}
                </td>
                <td>
                  <span class="badge badge-active" style="font-size: 0.8rem;">${catBadge}</span>
                  ${leadTime}
                </td>
                <td dir="ltr" style="text-align: right; font-family: monospace;">${phone}</td>
                <td style="text-align: center;">
                  <span class="badge" style="background: rgba(59,130,246,0.12); color: #3b82f6; font-weight: bold; padding: 4px 8px;">
                    ${invBadgeText}
                  </span>
                </td>
                <td style="color: var(--accent-green); font-weight: 600;">
                  ${totalPaid} <small>${currency}</small>
                </td>
                <td style="color: ${balance > 0 ? 'var(--accent-amber)' : 'var(--accent-green)'}; font-weight: bold; font-size: 0.95rem;">
                  ${this.formatNumber(balance)} <small>${currency}</small>
                </td>
                <td style="text-align: center; white-space: nowrap;">
                  <button class="btn btn-primary btn-sm" onclick="App.openVendorProfileModal(${s.id})" title="عرض ملف المورد الشامل (SRM)">
                    <i class="fa fa-id-card"></i> ملف المورد
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="Accounting.openEditSupplierModal(${s.id})" title="تعديل بيانات المورد">
                    <i class="fa fa-edit"></i> تعديل
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="Reports.showSupplierStatement(${s.id})" title="كشف الحساب">
                    كشف الحساب
                  </button>
                </td>
              </tr>
            `;}).join('');
          };

          if (window.UI && UI.Pagination && document.getElementById('suppliersPagination')) {
            UI.Pagination.create({
              containerId: 'suppliersPagination',
              data: list,
              pageSize: 15,
              onPageChange: (pageData) => renderRows(pageData)
            });
          } else {
            renderRows(list);
          }
        }
      }
    } catch (e) {
      console.error('Error loading suppliers table:', e);
    }
  },

  /**
   * فتح نافذة ملف تعريف المورد الشامل (SRM Vendor Profile Modal)
   * يعرض البيانات الأساسية الصارمة والتجميعات المالية الحية في الوقت الفعلي
   */
  async openVendorProfileModal(vendorId) {
    if (!vendorId) return;

    this.showDynamicModal(
      'ملف تعريف المورد (SRM Profile)',
      `<div style="text-align: center; padding: 40px;"><i class="fa fa-spinner fa-spin fa-2x" style="color: var(--accent-blue);"></i><p style="margin-top: 10px; color: var(--text-secondary);">جاري جلب الملف التعريفي والتحليلات المالية الحية...</p></div>`
    );

    try {
      const res = await fetch(`/api/suppliers/${vendorId}/profile?include_recent=true`);
      const json = await res.json();
      if (!json.success || !json.data) {
        document.getElementById('dynamicAppModalBody').innerHTML = `
          <div class="alert alert-danger" style="margin: 20px;">
            تعذر جلب ملف المورد: ${json.message || 'المورد غير موجود'}
          </div>
        `;
        return;
      }

      const v = json.data;
      const fin = v.financial_summary || {};
      const bank = v.bank_details || {};
      const currency = v.default_currency || 'YER';

      // شارة حالة السداد
      let statusColor = '#10b981';
      let statusBg = 'rgba(16, 185, 129, 0.12)';
      if (fin.settlement_status === 'pending_settlement') {
        statusColor = '#ef4444';
        statusBg = 'rgba(239, 68, 68, 0.12)';
      } else if (fin.settlement_status === 'partially_settled') {
        statusColor = '#f59e0b';
        statusBg = 'rgba(245, 158, 11, 0.12)';
      }

      const content = `
        <div class="srm-profile-container" style="direction: rtl; font-family: inherit;">
          
          <!-- بطاقة الترويسة الرئيسية -->
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; background: var(--bg-secondary, #1e293b); padding: 18px 24px; border-radius: 12px; margin-bottom: 20px; border: 1px solid var(--border-color, #334155);">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <h2 style="margin: 0; font-size: 1.35rem; color: var(--text-primary); font-weight: 700;">${v.company_name}</h2>
                <span class="badge" style="background: rgba(59,130,246,0.15); color: #3b82f6; font-size: 0.85rem; padding: 4px 10px;">${v.industry_category}</span>
                <span class="badge" style="background: ${statusBg}; color: ${statusColor}; font-size: 0.85rem; padding: 4px 10px;">${fin.settlement_status_label || 'نشط'}</span>
              </div>
              <div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 6px;">
                معرف المورد: <code>#VEN-${v.id}</code> &nbsp;|&nbsp; الشخص المسؤول: <strong>${v.contact_person || 'غير محدد'}</strong> &nbsp;|&nbsp; العملة: <strong>${currency}</strong>
              </div>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <button class="btn btn-primary btn-sm" onclick="Accounting.openEditSupplierModal(${v.id}); App.closeModal('dynamicAppModal');">
                <i class="fa fa-edit"></i> تعديل بيانات المورد
              </button>
              <button class="btn btn-secondary btn-sm" onclick="Reports.showSupplierStatement(${v.id}); App.closeModal('dynamicAppModal');">
                <i class="fa fa-file-text-o"></i> كشف الحساب
              </button>
            </div>
          </div>

          <!-- المؤشرات المالية التجميعية اللحظية (تلقائية 100%) -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 24px;">
            
            <div style="background: var(--card-bg, #0f172a); border: 1px solid var(--border-color, #334155); border-radius: 10px; padding: 16px; border-right: 4px solid #3b82f6;">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">إجمالي المشتريات من سابق (عدد الفواتير)</div>
              <div style="font-size: 1.5rem; font-weight: 700; color: #3b82f6;">${fin.total_purchase_invoices_count} <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-muted);">فاتورة شراء (تلقائي)</span></div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">إجمالي المفوتر: <strong>${this.formatNumber(fin.total_invoiced_amount)} ${currency}</strong></div>
            </div>

            <div style="background: var(--card-bg, #0f172a); border: 1px solid var(--border-color, #334155); border-radius: 10px; padding: 16px; border-right: 4px solid #10b981;">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">المبالغ المسددة من سابق (SUM Paid)</div>
              <div style="font-size: 1.4rem; font-weight: 700; color: #10b981;">${this.formatNumber(fin.total_amount_paid)} <span style="font-size: 0.8rem; font-weight: normal;">${currency}</span></div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">معاملات الصرف المسواة (${fin.payment_coverage_ratio_pct}% سداد)</div>
            </div>

            <div style="background: var(--card-bg, #0f172a); border: 1px solid var(--border-color, #334155); border-radius: 10px; padding: 16px; border-right: 4px solid ${fin.outstanding_balance > 0 ? '#f59e0b' : '#10b981'};">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">إجمالي الرصيد المستحق (المتبقي له)</div>
              <div style="font-size: 1.4rem; font-weight: 700; color: ${fin.outstanding_balance > 0 ? '#f59e0b' : '#10b981'};">
                ${this.formatNumber(fin.outstanding_balance)} <span style="font-size: 0.8rem; font-weight: normal;">${currency}</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">(المفوتر - المسدد) ديناميكياً 100%</div>
            </div>

          </div>

          <!-- تفاصيل البيانات الأساسية + البيانات المصرفية الآمنة -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; margin-bottom: 24px;">
            
            <!-- البيانات الأساسية والتشغيلية -->
            <div style="background: var(--bg-secondary, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 20px;">
              <h4 style="margin-top: 0; margin-bottom: 16px; font-size: 1rem; color: var(--text-primary); border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 8px;">
                <i class="fa fa-info-circle" style="color: #3b82f6;"></i> البيانات الأساسية والتعاقدية (Master Data)
              </h4>
              <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.9rem;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">الشخص المسؤول (اسم التاجر):</span>
                  <strong>${v.contact_person || 'غير محدد'}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">رقم الهاتف المعتمد:</span>
                  <strong dir="ltr"><a href="tel:${v.phone_number}" style="color: #3b82f6; text-decoration: none;">${v.phone_number || '-'}</a></strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">مدة توريد المواد:</span>
                  <span><strong style="color: var(--accent-amber);">${v.supply_lead_time_days}</strong> أيام</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">توضيح نوع الصرف ومستند الدفع:</span>
                  <span class="badge" style="background: rgba(139,92,246,0.15); color: #8b5cf6;">${v.payment_document_type}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">الرقم الضريبي:</span>
                  <span>${v.tax_id || 'غير مسجل'}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">السجل التجاري:</span>
                  <span>${v.commercial_reg_no || 'غير مسجل'}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">الحد الائتماني المسموح:</span>
                  <span>${this.formatNumber(v.credit_limit)} ${currency}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">رقم المبلغ (الرصيد الافتتاحي):</span>
                  <strong style="color: #3b82f6;">${this.formatNumber(v.balance || 0)} ${currency}</strong>
                </div>
              </div>
            </div>

            <!-- البيانات المصرفية المشفرة والمقنعة -->
            <div style="background: var(--bg-secondary, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 8px; margin-bottom: 16px;">
                <h4 style="margin: 0; font-size: 1rem; color: var(--text-primary);">
                  <i class="fa fa-lock" style="color: #10b981;"></i> الحساب المصرفي والتحويلات (Vault)
                </h4>
                <span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.75rem;">مشفر AES-256-GCM 🛡️</span>
              </div>
              <div id="vendorBankVaultCard_${v.id}">
                <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.9rem;">
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: var(--text-secondary);">اسم البنك:</span>
                    <strong>${bank.bank_name || 'غير محدد'}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: var(--text-secondary);">رقم الحساب (مقنّع):</span>
                    <code dir="ltr" style="background: rgba(0,0,0,0.25); padding: 2px 8px; border-radius: 4px; color: #38bdf8;">${bank.account_number_masked}</code>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: var(--text-secondary);">رقم الآيبان IBAN (مقنّع):</span>
                    <code dir="ltr" style="background: rgba(0,0,0,0.25); padding: 2px 8px; border-radius: 4px; color: #38bdf8;">${bank.iban_masked}</code>
                  </div>
                </div>
                <div style="margin-top: 18px; padding-top: 14px; border-top: 1px dashed var(--border-color, #334155); text-align: center;">
                  <button class="btn btn-secondary btn-sm" onclick="App.showFullVendorBankDetails(${v.id})" style="border: 1px solid #10b981; color: #10b981;">
                    <i class="fa fa-key"></i> فك التشفير وعرض الحساب البنكي الكامل
                  </button>
                  <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 6px;">متاح للصلاحيات المالية المعتمدة فقط مع تسجيل عملية تدقيق</div>
                </div>
              </div>
            </div>

          </div>

          <!-- المعاملات والفواتير المحملة مسبقاً (Eager-loaded Lists) -->
          <div style="background: var(--bg-secondary, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
              <h4 style="margin: 0; font-size: 1rem; color: var(--text-primary);">
                <i class="fa fa-history" style="color: #f59e0b;"></i> أحدث فواتير المشتريات التاريخية (Eager-Loaded)
              </h4>
              <span style="font-size: 0.8rem; color: var(--text-muted);">تم تحميلها في مسار استعلام متوازي دون تباطؤ</span>
            </div>

            <div class="table-responsive" style="max-height: 260px; overflow-y: auto;">
              <table class="custom-table" style="font-size: 0.85rem; width: 100%;">
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>التاريخ</th>
                    <th>المبلغ الإجمالي</th>
                    <th>المبلغ المسدد</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${(v.recent_invoices && v.recent_invoices.length > 0)
                    ? v.recent_invoices.map(inv => `
                        <tr>
                          <td><strong>${inv.invoice_no}</strong></td>
                          <td>${inv.date || '-'}</td>
                          <td style="font-weight: bold;">${this.formatNumber(inv.total_amount)} ${currency}</td>
                          <td style="color: #10b981;">${this.formatNumber(inv.paid_amount || 0)} ${currency}</td>
                          <td><span class="badge badge-active">${inv.status || 'معتمد'}</span></td>
                        </tr>
                      `).join('')
                    : `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 16px;">لا توجد فواتير شراء مسجلة لهذا المورد</td></tr>`
                  }
                </tbody>
              </table>
            </div>

            ${(v.recent_payments && v.recent_payments.length > 0) ? `
              <div style="margin-top: 20px;">
                <h5 style="margin-bottom: 10px; font-size: 0.95rem; color: var(--text-primary);">
                  <i class="fa fa-money" style="color: #10b981;"></i> سندات ومعاملات الصرف المنفذة (Cleared Payments)
                </h5>
                <div class="table-responsive" style="max-height: 200px; overflow-y: auto;">
                  <table class="custom-table" style="font-size: 0.85rem; width: 100%;">
                    <thead>
                      <tr>
                        <th>رقم السند</th>
                        <th>التاريخ</th>
                        <th>المبلغ المسدد</th>
                        <th>طريقة الدفع</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${v.recent_payments.map(pay => `
                        <tr>
                          <td><strong>${pay.receipt_no || pay.id}</strong></td>
                          <td>${pay.date || '-'}</td>
                          <td style="font-weight: bold; color: #10b981;">${this.formatNumber(pay.amount)} ${currency}</td>
                          <td>${pay.payment_method || 'تحويل بنكي / نقدي'}</td>
                          <td><span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981;">${pay.status || 'مسوى (cleared)'}</span></td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}

          </div>

          ${(() => {
            let atts = [];
            if (v.invoice_attachment) {
              try {
                atts = typeof v.invoice_attachment === 'string' ? JSON.parse(v.invoice_attachment) : v.invoice_attachment;
                if (!Array.isArray(atts)) atts = [atts];
              } catch (e) {
                if (typeof v.invoice_attachment === 'string' && v.invoice_attachment.startsWith('data:')) {
                  const isPdf = v.invoice_attachment.includes('application/pdf');
                  atts = [{ name: isPdf ? 'فاتورة_مرفقة.pdf' : 'فاتورة_ممسوحة.jpg', type: isPdf ? 'application/pdf' : 'image/jpeg', data: v.invoice_attachment }];
                }
              }
            }
            if (!atts || atts.length === 0) return '';
            if (typeof Accounting !== 'undefined') Accounting._supplierAttachments = atts;
            window._activeVendorAttachments = atts;
            if (typeof App !== 'undefined') App._supplierAttachments = atts;
            return `
              <div style="background: var(--bg-secondary, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 20px; margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                  <h4 style="margin: 0; font-size: 1rem; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
                    <i class="fa fa-paperclip"></i> المستندات والفواتير المرفقة (PDF / ماسح ضوئي 📄📸)
                  </h4>
                  <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.75rem;">${atts.length} مستندات</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${atts.map((att, i) => {
                    const isPdf = att.type === 'application/pdf' || (att.name && att.name.toLowerCase().endsWith('.pdf'));
                    const sizeStr = att.size ? (att.size > 1024 * 1024 ? `${(att.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(att.size / 1024)} KB`) : '';
                    return `
                      <div style="display: flex; align-items: center; justify-content: space-between; background: var(--card-bg, #0f172a); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 8px 14px;">
                        <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="Accounting.viewSupplierAttachment(${i})" title="انقر للمعاينة">
                          <span style="font-size: 1.2rem; display: flex; align-items: center;">${isPdf ? '📄' : (att.data ? `<img src="${att.data}" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px; border: 1px solid #334155;">` : '🖼️')}</span>
                          <div>
                            <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary);">${att.name || 'مستند فاتورة'}</div>
                            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                              <span class="badge" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; font-size: 0.68rem;">${isPdf ? 'مستند PDF' : 'صورة ممسوحة'}</span>
                              ${sizeStr ? `&nbsp;•&nbsp; <span>${sizeStr}</span>` : ''}
                            </div>
                          </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                          <button type="button" class="btn btn-secondary btn-sm" onclick="Accounting.viewSupplierAttachment(${i})" style="font-size: 0.78rem;">
                            <i class="fa fa-eye"></i> معاينة
                          </button>
                          ${att.data ? `
                            <a href="${att.data}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 0.78rem;" title="فتح في نافذة جديدة">
                              <i class="fa fa-external-link"></i>
                            </a>
                          ` : ''}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          })()}

          <!-- أزرار الإجراءات السفلية -->
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
            <button class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إغلاق</button>
          </div>

        </div>
      `;

      const titleEl = document.getElementById('dynamicAppModalTitle');
      const bodyEl = document.getElementById('dynamicAppModalBody');
      if (titleEl) titleEl.innerHTML = `<i class="fa fa-id-card-o" style="color: #3b82f6;"></i> ملف المورد: ${v.company_name}`;
      if (bodyEl) bodyEl.innerHTML = content;

    } catch (err) {
      console.error('Error fetching vendor profile:', err);
      const bodyEl = document.getElementById('dynamicAppModalBody');
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="alert alert-danger" style="margin: 20px;">
            حدث خطأ أثناء تحميل ملف المورد: ${err.message}
          </div>
        `;
      }
    }
  },

  /**
   * جلب البيانات المصرفية المفكوكة للمورد عند النقر والتأكيد للصلاحيات المالية
   */
  async showFullVendorBankDetails(vendorId) {
    const card = document.getElementById(`vendorBankVaultCard_${vendorId}`);
    if (!card) return;

    card.innerHTML = `<div style="text-align: center; padding: 15px;"><i class="fa fa-spinner fa-spin"></i> جاري فك التشفير الآمن...</div>`;

    try {
      const res = await fetch(`/api/suppliers/${vendorId}/bank-details`);
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.message || 'غير مخول');
      }

      const d = json.data;
      card.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.9rem; background: rgba(16,185,129,0.06); padding: 14px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.2);">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-secondary);">اسم البنك:</span>
            <strong>${d.bank_name}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text-secondary);">رقم الحساب الكامل:</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <code dir="ltr" style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; color: #10b981; font-weight: bold;">${d.account_number}</code>
              <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.75rem;" onclick="navigator.clipboard.writeText('${d.account_number}'); App.showToast('تم نسخ رقم الحساب بنجاح', 'success');" title="نسخ">📋</button>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text-secondary);">رقم الآيبان الكامل (IBAN):</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <code dir="ltr" style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; color: #10b981; font-weight: bold;">${d.iban}</code>
              <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.75rem;" onclick="navigator.clipboard.writeText('${d.iban}'); App.showToast('تم نسخ رقم الآيبان بنجاح', 'success');" title="نسخ">📋</button>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-secondary);">اسم المستفيد / صاحب الحساب:</span>
            <strong>${d.account_holder || d.company_name}</strong>
          </div>
        </div>
        <div style="font-size: 0.72rem; color: var(--accent-green); margin-top: 8px; text-align: center;">
          <i class="fa fa-check-circle"></i> تم فك التشفير بنجاح عبر مفتاح AES-256-GCM المؤسسي
        </div>
      `;
    } catch (err) {
      card.innerHTML = `
        <div class="alert alert-danger" style="margin: 10px; font-size: 0.85rem;">
          عذراً، فشل فك التشفير: ${err.message}. يرجى التأكد من امتلاك الصلاحيات المالية الكافية.
        </div>
      `;
    }
  },

  async loadCashTable(typeFilter) {
    const tbody = document.getElementById('fullCashTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 8);
    }

    const type = typeFilter || (typeof Accounting !== 'undefined' && Accounting._currentCashFilter) || 'الكل';
    if (typeof Accounting !== 'undefined') Accounting._currentCashFilter = type;

    try {
      let url = '/api/accounting/cash-movements';
      if (type && type !== 'الكل') {
        url += '?type=' + encodeURIComponent(type);
      }
      const res = await fetch(url);
      const json = await res.json();
      if (tbody && json.success) {
        const list = json.data || [];
        if (list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد حركات مسجلة (${type})</td></tr>`;
          const pag = document.getElementById('cashPagination');
          if (pag) pag.innerHTML = '';
        } else {
          const renderRows = (pageList) => {
            tbody.innerHTML = pageList.map(m => {
              const typeBadge = (m.movement_type === 'بنك' || m.movement_type === 'شيك')
                ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: bold;">🏦 بنك</span>`
                : `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: bold;">💵 نقدي</span>`;

              return `
                <tr>
                  <td>${m.date}</td>
                  <td style="text-align: center;">${typeBadge}</td>
                  <td>${this.formatNumber(m.previous_balance)}</td>
                  <td style="color: var(--accent-green); font-weight: bold;">${m.cash_in ? '+' + this.formatNumber(m.cash_in) : '-'}</td>
                  <td style="color: var(--accent-red); font-weight: bold;">${m.cash_out ? '-' + this.formatNumber(m.cash_out) : '-'}</td>
                  <td>${m.withdrawals ? this.formatNumber(m.withdrawals) : '-'}</td>
                  <td style="color: var(--gold-light); font-weight: bold;">${this.formatNumber(m.current_balance)}</td>
                  <td>
                    ${m.notes || '-'}
                    ${m.reference_no ? `<br><small style="font-family: monospace; color: var(--gold-light); font-weight: bold;">المرجع: ${m.reference_no}</small>` : ''}
                  </td>
                </tr>
              `;
            }).join('');
          };

          if (window.UI && UI.Pagination && document.getElementById('cashPagination')) {
            UI.Pagination.create({
              containerId: 'cashPagination',
              data: list,
              pageSize: 15,
              onPageChange: (pageData) => renderRows(pageData)
            });
          } else {
            renderRows(list);
          }
        }
      }
    } catch (e) {}
  },


  // النوافذ المنبثقة
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';

      // فحص واستعادة المسودات المحفوظة تلقائياً للنموذج
      const form = modal.querySelector('form');
      if (form && form.id && window.UI && UI.DraftManager) {
        UI.DraftManager.checkAndPromptDraft(form.id);
      }
    }
  },

  closeModal(modalId) {
    if (modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('active');
      }
    }
    const anyOtherModal = document.querySelectorAll('.modal-overlay.active, .modal.active');
    if (anyOtherModal.length === 0) {
      document.body.style.overflow = '';
    }
  },

  viewSupplierAttachment(index) {
    if (typeof Accounting !== 'undefined' && Accounting.viewSupplierAttachment) {
      Accounting.viewSupplierAttachment(index);
    }
  },

  showSupplierStatement(supplierId) {
    if (typeof Reports !== 'undefined' && Reports.showSupplierStatement) {
      Reports.showSupplierStatement(supplierId);
    }
  },

  showDynamicModal(title, content) {
    let modal = document.getElementById('dynamicAppModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dynamicAppModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-box modal-lg" style="max-width: 960px; width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding: 14px 20px;">
            <h3 class="modal-title" id="dynamicAppModalTitle" style="margin: 0; font-size: 1.15rem;"></h3>
            <button class="modal-close-btn" onclick="App.closeModal('dynamicAppModal')" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary);">&times;</button>
          </div>
          <div class="modal-body" id="dynamicAppModalBody" style="padding: 20px; overflow-y: auto; flex: 1;"></div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const titleEl = document.getElementById('dynamicAppModalTitle');
    const bodyEl = document.getElementById('dynamicAppModalBody');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = content;
    this.openModal('dynamicAppModal');
  },

  // رسائل التنبيه العائمة الفاخرة متعددة الطبقات (Toast Suite)
  showToast(message, type = 'info', action = null, duration = 4500) {
    // التوجيه إلى وحدة UI.Toast المتطورة مع شريط العد التنازلي والتراجع
    if (window.UI && UI.Toast) {
      return UI.Toast.show(message, type, action, duration);
    }

    const existing = document.querySelectorAll('.toast-msg');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;

    let icon = '🔔';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '⚠️';
    else if (type === 'warning') icon = '⚡';
    else if (type === 'info') icon = 'ℹ️';

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-text">${message}</div>
      </div>
      <button type="button" class="toast-close" title="إغلاق">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 250);
      };
    }

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.remove('toast-visible');
        setTimeout(() => {
          if (toast.parentElement) toast.remove();
        }, 350);
      }
    }, duration);
  },

  // تنسيق الأرقام بالفواصل المالية
  formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return Number(num).toLocaleString('en-US');
  },

  // مراقبة اتصال الشبكة في المتصفح وتحديث حالة قاعدة البيانات
  setupNetworkWatchers() {
    window.addEventListener('online', async () => {
      await this.checkDatabaseStatus();
      this.showToast('تم استعادة الاتصال بالشبكة، جاري فحص السيرفر السحابي 🌐', 'info');
    });

    window.addEventListener('offline', () => {
      this.updateConnectionUI({
        isOnline: false,
        mode: 'offline',
        activeDb: 'local',
        statusMessage: 'المتصفح في وضع عدم الاتصال - يعمل النظام محلياً (أوفلاين)'
      });
      this.showToast('أنت الآن غير متصل بالإنترنت - يتم حفظ بياناتك على قاعدة البيانات المحلية 🟠', 'warning');
    });
  },

  // التحقق المسبق من حالة قاعدة البيانات والاتصال
  async checkDatabaseStatus() {
    try {
      const res = await fetch('/api/settings/db-status');
      const json = await res.json();
      if (json && json.success) {
        this.dbStatus = json.data;
        this.updateConnectionUI(json.data);
        return json.data;
      }
    } catch (e) {
      console.warn('Database status check failed, using local offline mode:', e);
      const fallback = {
        isOnline: false,
        mode: 'offline',
        activeDb: 'local',
        statusMessage: 'الوضع المحلي (أوفلاين) نشط'
      };
      this.dbStatus = fallback;
      this.updateConnectionUI(fallback);
      return fallback;
    }
  },

  // التحكم بفتح وإغلاق قائمة الإشعارات المنسدلة وحالة الاتصال
  toggleNotificationsDropdown(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const dropdown = document.getElementById('notificationsDropdown');
    if (!dropdown) return;

    const isActive = dropdown.classList.contains('active');
    if (isActive) {
      dropdown.classList.remove('active');
    } else {
      this.renderNotificationsList();
      dropdown.classList.add('active');
    }
  },

  closeNotificationsDropdown() {
    const dropdown = document.getElementById('notificationsDropdown');
    if (dropdown) dropdown.classList.remove('active');
  },

  // تحديث شارة وحالة الاتصال داخل قائمة الإشعارات وشاشة تسجيل الدخول
  updateConnectionUI(status) {
    const isOnline = !!(status && status.isOnline);
    const latency = (status && status.latencyMs) || 0;

    // 1. بطاقة الاتصال الرئيسية داخل قائمة الإشعارات
    const notifCard = document.getElementById('notifConnCard');
    const notifIcon = document.getElementById('notifConnIcon');
    const notifTitle = document.getElementById('notifConnStatusTitle');
    const notifDesc = document.getElementById('notifConnStatusDesc');
    const notifBadge = document.getElementById('notifConnBadge');

    if (notifCard) {
      notifCard.className = `notif-conn-card ${isOnline ? 'status-online' : 'status-offline'}`;
    }
    if (notifIcon) {
      notifIcon.textContent = isOnline ? '🟢' : '🔴';
    }
    if (notifTitle) {
      notifTitle.textContent = isOnline ? `متصل بالسيرفر السحابي (${latency}ms)` : 'قاعدة البيانات المحلية (أوفلاين)';
    }
    if (notifDesc) {
      notifDesc.textContent = isOnline 
        ? 'المشروع متصل بقاعدة البيانات السحابية المركزية، وتتم المزامنة تلقائياً'
        : 'يعمل النظام محلياً على قاعدة بيانات SQLite، مع حفظ كافة التعديلات بأمان تام';
    }
    if (notifBadge) {
      notifBadge.className = `notif-conn-badge ${isOnline ? 'online' : 'offline'}`;
      notifBadge.textContent = isOnline ? '🟢 أونلاين' : '🔴 أوفلاين';
    }

    // 2. نقطة الإشعار على أيقونة الجرس
    const notifDot = document.getElementById('headerNotificationDot');
    if (notifDot) {
      notifDot.className = `notification-dot ${isOnline ? 'online' : 'offline'}`;
    }

    // 3. نقطة الحالة على صورة المستخدم
    const userAvatarDot = document.getElementById('userAvatarStatusDot');
    if (userAvatarDot) {
      userAvatarDot.className = `user-avatar-dot ${isOnline ? 'online' : 'offline'}`;
      userAvatarDot.setAttribute('title', isOnline ? 'أونلاين (سحابي)' : 'أوفلاين (محلي)');
    }

    // 4. شارة شاشة تسجيل الدخول
    const loginBadge = document.getElementById('loginConnectionBadge');
    const loginText = document.getElementById('loginConnectionText');
    const loginDot = document.getElementById('loginConnectionDot');

    if (loginBadge) {
      loginBadge.className = `connection-status-pill ${isOnline ? 'status-online' : 'status-offline'}`;
      loginBadge.setAttribute('title', isOnline ? `السيرفر السحابي متصل (${latency}ms) - انقر للتفاصيل` : 'قاعدة البيانات المحلية نشطة (أوفلاين) - انقر للتفاصيل');
    }
    if (loginText) {
      loginText.textContent = isOnline ? `متصل سحابياً (${latency}ms)` : 'قاعدة البيانات المحلية (أوفلاين)';
    }
    if (loginDot) {
      loginDot.className = `status-indicator-dot ${isOnline ? 'online' : 'offline'}`;
    }

    // 5. إعادة بناء قائمة الإشعارات
    this.renderNotificationsList();
  },

  // بناء عناصر قائمة الإشعارات ديناميكياً
  renderNotificationsList() {
    const listEl = document.getElementById('notifList');
    if (!listEl) return;

    const s = this.dbStatus || {};
    const isOnline = !!s.isOnline;
    const user = (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser.full_name : 'المستخدم';

    const items = [
      {
        icon: isOnline ? '🟢' : '🔴',
        iconClass: isOnline ? 'success' : 'warning',
        title: isOnline ? 'تم التحقق من الاتصال السحابي' : 'يعمل النظام على قاعدة البيانات المحلية',
        desc: isOnline ? `تم فحص السيرفر السحابي بنجاح (${s.latencyMs || 0}ms)` : 'الاتصال السحابي غير مفعل - البيانات تحفظ محلياً',
        time: 'عند تسجيل الدخول'
      },
      {
        icon: '💾',
        iconClass: 'info',
        title: 'نظام النسخ الاحتياطي التلقائي نشط',
        desc: 'يتم أخذ نسخة احتياطية فورية تلقائياً عند تسجيل الخروج لضمان عدم ضياع أي تعديل',
        time: 'تلقائي دائم'
      },
      {
        icon: '🛡️',
        iconClass: 'success',
        title: 'حماية وتكامل البيانات 100%',
        desc: 'كافة القيود والسندات والمشاريع تخزن فورياً بأعلى معايير الأمان المالي',
        time: 'النظام مؤمن'
      }
    ];

    listEl.innerHTML = items.map(item => `
      <div class="notif-item">
        <div class="notif-item-icon ${item.iconClass}">${item.icon}</div>
        <div class="notif-item-content">
          <div class="notif-item-title">${item.title}</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 2px;">${item.desc}</div>
          <div class="notif-item-time">${item.time}</div>
        </div>
      </div>
    `).join('');
  },

  // إظهار نافذة تفاصيل الاتصال والنسخ الاحتياطي
  showConnectionModal() {
    const modal = document.getElementById('connectionDetailsModal');
    if (!modal) return;

    const s = this.dbStatus || {};
    const modeEl = document.getElementById('connModalMode');
    const statusTextEl = document.getElementById('connModalStatusText');
    const latencyEl = document.getElementById('connModalLatency');
    const dbFileEl = document.getElementById('connModalDbFile');
    const lastBackupEl = document.getElementById('connModalLastBackup');

    if (modeEl) {
      modeEl.textContent = s.isOnline ? 'سحابي (Online)' : 'محلي (Offline - SQLite)';
      modeEl.className = s.isOnline ? 'badge badge-active' : 'badge badge-warning';
    }
    if (statusTextEl) statusTextEl.textContent = s.statusMessage || 'يعمل على قاعدة البيانات المحلية';
    if (latencyEl) latencyEl.textContent = s.isOnline ? `${s.latencyMs || 0} ms` : '0 ms (محلي فوري)';
    if (dbFileEl) dbFileEl.textContent = s.localDbFile || 'rawasi_aden.db';

    if (lastBackupEl) {
      if (s.lastLogoutBackup) {
        lastBackupEl.innerHTML = `
          <strong style="color: var(--gold-light);">${s.lastLogoutBackup.fileName}</strong><br>
          <small style="color: var(--text-secondary);">المستخدم: ${s.lastLogoutBackup.username} | التاريخ: ${s.lastLogoutBackup.displayTime} | الحجم: ${(s.lastLogoutBackup.size / 1024).toFixed(1)} KB</small>
        `;
      } else {
        lastBackupEl.innerHTML = '<span style="color: var(--text-secondary);">سيتم إنشاء أول نسخة تلقائياً عند تسجيل الخروج القادم</span>';
      }
    }

    this.openModal('connectionDetailsModal');
  },

  // إعادة فحص الاتصال يدوياً من النافذة
  async recheckConnectionModal() {
    const btn = document.getElementById('btnRecheckConn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري التحقق... ⏳';
    }
    try {
      const data = await this.checkDatabaseStatus();
      this.showConnectionModal();
      if (data && data.isOnline) {
        this.showToast('تم التحقق بنجاح: متصل بالسيرفر السحابي 🟢', 'success');
      } else {
        this.showToast('تم التحقق: النظام يعمل بنجاح على قاعدة البيانات المحلية 🟠', 'info');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'إعادة فحص الاتصال الآن 🔄';
      }
    }
  },

  // ================== إدارة حالة النسخ الاحتياطي التلقائي في الهيدر ==================
  async initAutoBackupHeader() {
    await this.fetchAutoBackupStatus();
    // تحديث دوري كل 60 ثانية
    setInterval(() => this.fetchAutoBackupStatus(), 60 * 1000);
  },

  async fetchAutoBackupStatus() {
    try {
      const res = await fetch('/api/settings/auto-backup/status');
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data) {
        this.updateAutoBackupHeaderUI(json.data);
      }
    } catch (e) {
      // إهمال أخطاء الشبكة المؤقتة
    }
  },

  updateAutoBackupHeaderUI(d) {
    const iconEl = document.getElementById('headerBackupIcon');
    const pulseEl = document.getElementById('headerBackupPulse');
    const titleEl = document.getElementById('headerBackupTitle');
    const subEl = document.getElementById('headerBackupSub');
    const badgeEl = document.getElementById('headerBackupBadge');

    const intervalEl = document.getElementById('dropdownBackupInterval');
    const pathEl = document.getElementById('dropdownBackupPath');
    const lastTimeEl = document.getElementById('dropdownBackupLastTime');
    const lastSizeEl = document.getElementById('dropdownBackupLastSize');
    const nextTimeEl = document.getElementById('dropdownBackupNextTime');

    if (!iconEl) return;

    if (!d.enabled) {
      if (pulseEl) pulseEl.className = 'backup-status-pulse warning';
      if (titleEl) titleEl.textContent = 'النسخ الآلي: معطل';
      if (subEl) subEl.textContent = 'تنبيه الأمان';
      if (badgeEl) {
        badgeEl.textContent = 'معطل';
        badgeEl.style.background = 'rgba(234, 179, 8, 0.2)';
        badgeEl.style.color = '#facc15';
        badgeEl.style.borderColor = 'rgba(234, 179, 8, 0.4)';
      }
    } else if (d.lastStatus === 'failed') {
      if (pulseEl) pulseEl.className = 'backup-status-pulse danger';
      if (titleEl) titleEl.textContent = 'النسخ الآلي: فشل';
      if (subEl) subEl.textContent = 'مطلوب المراجعة ⚠️';
      if (badgeEl) {
        badgeEl.textContent = 'خطأ';
        badgeEl.style.background = 'rgba(239, 68, 68, 0.2)';
        badgeEl.style.color = '#f87171';
        badgeEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      }
    } else {
      if (pulseEl) pulseEl.className = 'backup-status-pulse';
      if (titleEl) titleEl.textContent = `النسخ الآلي: ${d.intervalLabel || 'مجدول'}`;
      if (subEl) subEl.textContent = d.lastRun ? 'محمي ومحدث 🛡️' : 'مجدول ونشط 🛡️';
      if (badgeEl) {
        badgeEl.textContent = 'مفعل';
        badgeEl.style.background = 'rgba(34, 197, 94, 0.2)';
        badgeEl.style.color = '#4ade80';
        badgeEl.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      }
    }

    if (intervalEl) {
      intervalEl.textContent = d.interval === 'weekly' 
        ? `أسبوعياً (كل ${d.dayOfWeekName || 'جمعة'} - ${d.time || '02:00'})`
        : `يومياً (الساعة ${d.time || '02:00'})`;
    }

    if (pathEl) {
      pathEl.textContent = d.storagePath || 'server/database/backups';
      pathEl.title = d.storagePath || '';
    }

    if (lastTimeEl) {
      if (d.lastRun) {
        const lrDate = new Date(d.lastRun);
        lastTimeEl.innerHTML = `${lrDate.toLocaleDateString('ar-YE')} ${lrDate.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })} ${d.lastStatus === 'success' ? '✅' : '❌'}`;
      } else {
        lastTimeEl.textContent = 'بانتظار أول موعد';
      }
    }

    if (lastSizeEl) {
      lastSizeEl.textContent = d.lastSize ? `${(d.lastSize / (1024 * 1024)).toFixed(2)} MB` : '-';
    }

    if (nextTimeEl) {
      if (d.nextRun && d.enabled) {
        const nrDate = new Date(d.nextRun);
        nextTimeEl.innerHTML = `${nrDate.toLocaleDateString('ar-YE')} ${nrDate.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })} <span style="font-size:0.75rem; color:#94a3b8;">(${d.countdownText || ''})</span>`;
      } else {
        nextTimeEl.textContent = d.enabled ? 'جاري الحساب...' : 'الجدولة متوقفة';
      }
    }
  },

  toggleBackupStatusDropdown(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const dropdown = document.getElementById('backupStatusDropdown');
    if (!dropdown) return;
    const isActive = dropdown.classList.contains('active');
    // إغلاق إشعارات النظام الأخرى إن كانت مفتوحة
    this.closeNotificationsDropdown();
    if (isActive) {
      dropdown.classList.remove('active');
    } else {
      this.fetchAutoBackupStatus();
      dropdown.classList.add('active');
    }
  },

  closeBackupStatusDropdown() {
    const dropdown = document.getElementById('backupStatusDropdown');
    if (dropdown) dropdown.classList.remove('active');
  },

  async triggerAutoBackupNow(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const btn = document.getElementById('btnHeaderRunBackupNow');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>جاري النسخ... ⏳</span>';
    }

    try {
      const res = await fetch('/api/settings/auto-backup/run-now', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        this.showToast(json.message || 'تم إنشاء النسخة التلقائية بنجاح 🛡️', 'success');
        await this.fetchAutoBackupStatus();
        if (this.activeView === 'settings' && typeof Settings !== 'undefined' && Settings.loadAutoBackupSchedule) {
          Settings.loadAutoBackupSchedule();
        }
      } else {
        this.showToast(json.message || 'فشل تشغيل النسخ التلقائي', 'error');
      }
    } catch (err) {
      this.showToast('خطأ في الاتصال بالخادم أثناء النسخ', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  openBackupSettingsTab() {
    this.closeBackupStatusDropdown();
    this.navigate('settings');
    setTimeout(() => {
      if (typeof Settings !== 'undefined' && Settings.switchTab) {
        Settings.switchTab('backup');
      }
    }, 250);
  },

  // ============================================================================
  // دوال سلسلة دورة حياة العميل المالية (Client Lifecycle & Financial Chain)
  // تسلسل الأثر المالي الآلي: عميل ➔ عقد ➔ مشاريع ➔ مستخلصات ➔ دفعات ➔ محتجزات ➔ رصيد
  // ============================================================================

  async openClientChainModal(clientId) {
    this.currentChainClientId = clientId;
    this.openModal('clientChainModal');
    this.switchChainTab('hierarchy');

    const treeContainer = document.getElementById('chainHierarchyTreeContainer');
    if (treeContainer) {
      treeContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-secondary);">جاري استدعاء شجرة دورة حياة العميل والتدقيق المالي... ⏳</div>';
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/chain`);
      const json = await res.json();
      if (!json.success || !json.data) {
        this.showToast('تعذر جلب بيانات سلسلة العميل', 'error');
        return;
      }

      const chain = json.data;
      this.currentChainData = chain;

      const client = chain.client || {};
      const fin = chain.financial_summary || {};
      const curr = client.currency || 'ر.ي';

      // 1. ترويسة النافذة
      const nameEl = document.getElementById('chainClientName');
      if (nameEl) nameEl.innerText = client.name || 'العميل';
      const compEl = document.getElementById('chainClientCompanyBadge');
      if (compEl) compEl.innerText = client.company ? `شركة: ${client.company}` : 'عميل مباشر';

      // 2. شريط التدفق التفاعلي Pipeline
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
      };

      const contractsCount = fin.total_contracts_count ?? chain.chain?.contracts_count ?? (chain.contracts || []).length;
      const projectsCount = fin.total_projects_count ?? chain.chain?.projects_count ?? (chain.projects || []).length;
      const billsCount = fin.total_bills_count ?? chain.chain?.bills_count ?? (chain.bills || []).length;
      const paymentsCount = fin.total_payments_count ?? chain.chain?.payments_count ?? (chain.payments || []).length;

      setTxt('pipeClientName', client.name || '-');
      setTxt('pipeContractsCount', `${contractsCount} عقد`);
      setTxt('pipeProjectsCount', `${projectsCount} مشروع`);
      setTxt('pipeBillsCount', `${billsCount} مستخلص`);
      setTxt('pipeCollectionsTotal', `${this.formatNumber(fin.total_collected ?? fin.total_collections ?? 0)} ${curr}`);
      setTxt('pipeRetentionActive', `${this.formatNumber(fin.active_retention_balance || 0)} ${curr}`);
      setTxt('pipeOutstandingDue', `${this.formatNumber(fin.outstanding_due_balance || 0)} ${curr}`);

      // 3. بطاقات المؤشرات المالية التفصيلية
      setTxt('chainSummaryContracts', `${this.formatNumber(fin.total_contracts_value ?? fin.total_contract_value ?? 0)} ${curr}`);
      setTxt('chainSummaryContractsSub', `${contractsCount} عقود ومشاريع معتمدة`);

      setTxt('chainSummaryGross', `${this.formatNumber(fin.total_gross_billed ?? fin.gross_work_completed ?? 0)} ${curr}`);
      setTxt('chainSummaryGrossSub', `إجمالي الأعمال المنجزة`);

      setTxt('chainSummaryInvoiced', `${this.formatNumber(fin.total_net_billed ?? fin.net_invoiced_claims ?? 0)} ${curr}`);
      setTxt('chainSummaryInvoicedSub', `${billsCount} مستخلصات معتمدة`);

      setTxt('chainSummaryCollected', `${this.formatNumber(fin.total_collected ?? fin.total_collections ?? 0)} ${curr}`);
      setTxt('chainSummaryCollectedSub', `مقدم: ${this.formatNumber(fin.total_advance_received || 0)} + تحصيل: ${this.formatNumber((fin.total_collected || 0) - (fin.total_advance_received || 0))}`);

      setTxt('chainSummaryRetention', `${this.formatNumber(fin.active_retention_balance || 0)} ${curr}`);
      setTxt('chainSummaryRetentionSub', `محسوم: ${this.formatNumber(fin.total_retention_deductions ?? fin.total_retention_held ?? 0)} | مفرج: ${this.formatNumber(fin.total_retention_released || 0)}`);

      setTxt('chainSummaryDue', `${this.formatNumber(fin.outstanding_due_balance || 0)} ${curr}`);
      setTxt('chainSummaryDueSub', `تحديث لحظي بدون انحراف (Zero Drift)`);

      // أعداد التبويبات
      setTxt('chainTabBillsCount', billsCount);
      setTxt('chainTabReceiptsCount', paymentsCount);

      // 4. بناء الشجرة الهرمية
      this.renderChainHierarchyTree(chain);

      // 5. تعبئة تبويب المستخلصات
      this.renderChainBillsTable(chain.bills || chain.chain?.bills || [], curr, client.id);

      // 6. تعبئة تبويب سندات القبض
      this.renderChainReceiptsTable(chain.payments || chain.chain?.payments || [], curr);

      // 7. تعبئة تبويب محتجزات الضمان
      this.renderChainRetentionTable(chain, curr);

    } catch (err) {
      console.error('Error fetching client chain:', err);
      this.showToast('خطأ في استدعاء سلسلة العميل المالية', 'error');
    }
  },

  renderChainHierarchyTree(chain) {
    const container = document.getElementById('chainHierarchyTreeContainer');
    if (!container) return;

    const rawContracts = chain.contracts || chain.chain?.contracts || [];
    const allProjects = chain.projects || chain.chain?.projects || [];
    const allBills = chain.bills || chain.chain?.bills || [];
    const allPayments = chain.payments || chain.chain?.payments || [];
    const curr = chain.client?.currency || 'ر.ي';
    const clientId = chain.client?.id || this.currentChainClientId;

    if (rawContracts.length === 0 && allProjects.length === 0 && allBills.length === 0) {
      container.innerHTML = `
        <div style="background: rgba(15,23,42,0.4); border: 1px dashed var(--border-color); border-radius: 8px; padding: 25px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">📂</div>
          <p>لا توجد عقود أو مشاريع مرتبطة بهذا العميل حتى الآن.</p>
          <div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
            <button class="btn btn-primary btn-sm" onclick="App.openNewProjectForClientFromChain()">+ إضافة مشروع جديد للعميل</button>
            <button class="btn btn-secondary btn-sm" onclick="App.openNewClientBillFromChain()">+ إصدار مستخلص جديد</button>
          </div>
        </div>
      `;
      return;
    }

    let html = '';

    // التحقق مما إذا كانت rawContracts عبارة عن مجموعات عقود ومشاريع (Grouped Contract Objects)
    const isGrouped = rawContracts.length > 0 && ('contract' in rawContracts[0]);

    if (isGrouped) {
      rawContracts.forEach(group => {
        const contract = group.contract || {};
        const isOfficial = contract.id && contract.id > 0;
        const gProjects = group.projects || [];
        const gSummary = group.summary || {};

        html += `
          <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid ${isOfficial ? 'rgba(56, 189, 248, 0.3)' : 'rgba(167, 139, 250, 0.3)'}; border-radius: 10px; padding: 16px; margin-bottom: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
            <!-- ترويسة العقد أو تصنيف المشاريع -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(255,255,255,0.12); padding-bottom: 12px; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 1.4rem;">${isOfficial ? '📜' : '🏗️'}</span>
                <div>
                  <div style="font-size: 1rem; font-weight: 700; color: ${isOfficial ? '#38bdf8' : '#a78bfa'};">
                    ${isOfficial ? `عقد رسمي: ${contract.contract_no || ''} ${contract.title ? '- ' + contract.title : ''}` : 'مشاريع وأعمال مباشرة للعميل (أوامر تكليف)'}
                  </div>
                  <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 2px;">
                    ${isOfficial ? `تاريخ التوقيع: ${contract.signing_date || contract.created_at?.split('T')[0] || '-'} | الحالة: ${contract.status || 'ساري'}` : `${gProjects.length} مشاريع مرتبطة بحساب العميل مباشرة`}
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.85rem; padding: 4px 10px;">
                  قيمة العقد/الأعمال: ${this.formatNumber(contract.contract_value || gSummary.contract_value || 0)} ${curr}
                </span>
                ${isOfficial ? `
                  <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light); font-size: 0.8rem;">دفعة مقدمة: ${contract.advance_payment_pct || 10}%</span>
                  <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-size: 0.8rem;">محتجز ضمان: ${contract.retention_pct || 10}%</span>
                ` : ''}
              </div>
            </div>

            <!-- قائمة المشاريع التابعة -->
            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${gProjects.map(pWrap => {
                const p = pWrap.project || pWrap;
                const pBills = pWrap.bills || [];
                const fin = pWrap.financials || {};

                return `
                  <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px;">
                    <!-- رأس بطاقة المشروع -->
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.1rem; color: #a78bfa;">🏗️</span>
                        <strong style="color: #fff; font-size: 0.95rem;">${p.name}</strong>
                        <span class="badge" style="background: rgba(255,255,255,0.06); color: #94a3b8; font-size: 0.72rem;">${p.code || ('PRJ-' + p.id)}</span>
                        <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-green); font-size: 0.72rem;">${p.status || 'نشط'}</span>
                      </div>
                      <div style="display: flex; gap: 6px;">
                        <button class="btn btn-secondary btn-sm" onclick="App.openNewClientBillModal(${clientId}, ${isOfficial ? contract.id : 'null'}, ${p.id})" style="font-size: 0.72rem; padding: 3px 8px;">
                          + مستخلص للمشروع
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="Accounting.openNewReceiptModal({ client_id: ${clientId}, project_id: ${p.id}, contract_id: ${isOfficial ? contract.id : 'null'} })" style="font-size: 0.72rem; padding: 3px 8px; background: var(--accent-green); border-color: var(--accent-green);">
                          💵 قبض دفعة
                        </button>
                      </div>
                    </div>

                    <!-- شبكة المؤشرات المالية المصغرة للمشروع -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px; margin-bottom: 10px; font-size: 0.72rem; text-align: center;">
                      <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: var(--text-secondary);">قيمة المشروع:</span>
                        <div style="font-weight: 700; color: #38bdf8;">${this.formatNumber(fin.contract_value || p.contract_value || 0)}</div>
                      </div>
                      <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: var(--text-secondary);">المنجز (Gross):</span>
                        <div style="font-weight: 700; color: #fff;">${this.formatNumber(fin.gross_billed || 0)}</div>
                      </div>
                      <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: var(--text-secondary);">صافي المطالبات:</span>
                        <div style="font-weight: 700; color: var(--gold-light);">${this.formatNumber(fin.net_billed || 0)}</div>
                      </div>
                      <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: var(--text-secondary);">المحصل:</span>
                        <div style="font-weight: 700; color: var(--accent-green);">${this.formatNumber(fin.total_collected || 0)}</div>
                      </div>
                      <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: var(--text-secondary);">محتجز الضمان:</span>
                        <div style="font-weight: 700; color: #f59e0b;">${this.formatNumber(fin.active_retention || 0)}</div>
                      </div>
                      <div style="background: rgba(0,0,0,0.25); padding: 5px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.3);">
                        <span style="color: var(--accent-red); font-weight: 700;">المتبقي المستحق:</span>
                        <div style="font-weight: 800; color: var(--accent-red);">${this.formatNumber(fin.outstanding_due || 0)}</div>
                      </div>
                    </div>

                    <!-- مستخلصات المشروع -->
                    ${pBills.length > 0 ? `
                      <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px;">
                        <div style="font-size: 0.75rem; font-weight: 700; color: #facc15; margin-bottom: 6px;">📑 المستخلصات المعتمدة للمشروع (${pBills.length}):</div>
                        <div class="table-responsive">
                          <table class="custom-table" style="font-size: 0.74rem;">
                            <thead>
                              <tr>
                                <th>رقم المستخلص</th>
                                <th>التاريخ</th>
                                <th>إجمالي الأعمال</th>
                                <th>استقطاع مقدم</th>
                                <th>محتجز ضمان</th>
                                <th>الصافي</th>
                                <th>المحصل</th>
                                <th>المتبقي</th>
                                <th>الحالة</th>
                                <th style="text-align: center;">إجراء</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${pBills.map(b => {
                                const net = Number(b.net_amount || b.amount || 0);
                                const paid = Number(b.paid_amount || 0);
                                const rem = Number(b.remaining_amount !== undefined ? b.remaining_amount : Math.max(0, net - paid));
                                const isFullyPaid = (b.payment_status === 'paid' || rem <= 0);
                                const statusColor = isFullyPaid ? 'var(--accent-green)' : (paid > 0 ? '#38bdf8' : 'var(--accent-red)');

                                return `
                                  <tr>
                                    <td><strong>${b.bill_no}</strong></td>
                                    <td>${b.date || '-'}</td>
                                    <td>${this.formatNumber(b.gross_amount || net)} ${curr}</td>
                                    <td style="color: #38bdf8;">-${this.formatNumber(b.advance_deduction || 0)}</td>
                                    <td style="color: #f59e0b;">-${this.formatNumber(b.retention_deduction || 0)}</td>
                                    <td style="font-weight: 700; color: var(--gold-light);">${this.formatNumber(net)} ${curr}</td>
                                    <td style="color: var(--accent-green);">${this.formatNumber(paid)}</td>
                                    <td style="font-weight: 700; color: ${rem > 0 ? 'var(--accent-red)' : 'var(--text-secondary)'};">${this.formatNumber(rem)}</td>
                                    <td><span class="badge" style="color: ${statusColor}; border: 1px solid ${statusColor}; font-size: 0.7rem;">${b.status || (isFullyPaid ? 'محصل كامل' : 'معتمد')}</span></td>
                                    <td style="text-align: center;">
                                      ${!isFullyPaid ? `
                                        <button class="btn btn-primary btn-sm" onclick="App.quickCollectForBill(${b.id}, ${clientId}, ${p.id}, ${rem}, '${b.bill_no}')" style="padding: 2px 7px; font-size: 0.7rem; background: var(--accent-green); border-color: var(--accent-green);">
                                          قبض دفعة
                                        </button>
                                      ` : '<span style="color: var(--accent-green); font-size: 0.72rem;">✓ تم السداد</span>'}
                                    </td>
                                  </tr>
                                `;
                              }).join('')}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ` : '<div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 4px;">لا توجد مستخلصات مسجلة لهذا المشروع بعد.</div>'}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });
    } else {
      // تنسيق مباشر من مصفوفة المشاريع والعقود المسطحة
      html = `
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(167, 139, 250, 0.3); border-radius: 10px; padding: 16px;">
          <div style="font-size: 1rem; font-weight: 700; color: #a78bfa; margin-bottom: 12px;">🏗️ المشاريع المرتبطة بالعميل (${allProjects.length}):</div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${allProjects.map(p => `
              <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="color: #fff; font-size: 0.95rem;">${p.name}</strong>
                  <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">
                    رمز: ${p.code || ('PRJ-' + p.id)} | قيمة العقد: ${this.formatNumber(p.contract_value || 0)} ${curr} | الحالة: ${p.status || 'نشط'}
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-secondary btn-sm" onclick="App.openNewClientBillModal(${clientId}, null, ${p.id})" style="font-size: 0.72rem; padding: 3px 8px;">+ مستخلص</button>
                  <button class="btn btn-primary btn-sm" onclick="Accounting.openNewReceiptModal({ client_id: ${clientId}, project_id: ${p.id} })" style="font-size: 0.72rem; padding: 3px 8px; background: var(--accent-green); border-color: var(--accent-green);">💵 قبض دفعة</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  },

  renderChainBillsTable(bills, curr, clientId) {
    const tbody = document.getElementById('chainBillsTableBody');
    if (!tbody) return;

    if (bills.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد مستخلصات مسجلة لهذا العميل حتى الآن</td></tr>`;
      return;
    }

    tbody.innerHTML = bills.map(b => {
      const net = Number(b.net_amount || b.amount || 0);
      const paid = Number(b.paid_amount || 0);
      const rem = Number(b.remaining_amount !== undefined ? b.remaining_amount : Math.max(0, net - paid));
      const isFullyPaid = (b.payment_status === 'paid' || rem <= 0);
      const statusColor = isFullyPaid ? 'var(--accent-green)' : (paid > 0 ? '#38bdf8' : 'var(--accent-red)');

      return `
        <tr>
          <td><strong style="color: #fff;">${b.bill_no}</strong></td>
          <td>${b.project_name || '-'}</td>
          <td>${b.date || '-'}</td>
          <td>${this.formatNumber(b.gross_amount || net)} ${curr}</td>
          <td style="color: #38bdf8;">-${this.formatNumber(b.advance_deduction || 0)}</td>
          <td style="color: #f59e0b;">-${this.formatNumber(b.retention_deduction || 0)}</td>
          <td style="font-weight: 700; color: var(--gold-light);">${this.formatNumber(net)} ${curr}</td>
          <td style="color: var(--accent-green);">${this.formatNumber(paid)}</td>
          <td style="font-weight: 800; color: ${rem > 0 ? 'var(--accent-red)' : 'var(--text-secondary)'};">${this.formatNumber(rem)}</td>
          <td><span class="badge" style="color: ${statusColor}; border: 1px solid ${statusColor};">${b.status || (isFullyPaid ? 'محصل كامل' : 'معتمد')}</span></td>
          <td style="text-align: center;">
            ${!isFullyPaid ? `
              <button class="btn btn-primary btn-sm" onclick="App.quickCollectForBill(${b.id}, ${clientId}, ${b.project_id}, ${rem}, '${b.bill_no}')" style="padding: 3px 8px; font-size: 0.75rem;">
                قبض دفعة
              </button>
            ` : '<span style="color: var(--accent-green); font-size: 0.78rem;">✓ تم التحصيل</span>'}
          </td>
        </tr>
      `;
    }).join('');
  },

  renderChainReceiptsTable(payments, curr) {
    const tbody = document.getElementById('chainReceiptsTableBody');
    if (!tbody) return;

    if (payments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد سندات قبض مسجلة لهذا العميل حتى الآن</td></tr>`;
      return;
    }

    tbody.innerHTML = payments.map(p => {
      let catText = 'تحصيل مستخلص';
      let catColor = 'var(--accent-green)';
      if (p.receipt_category === 'advance_payment') {
        catText = 'دفعة مقدمة على العقد';
        catColor = '#38bdf8';
      } else if (p.receipt_category === 'retention_release') {
        catText = 'إفراج محتجز ضمان';
        catColor = '#f59e0b';
      } else if (p.receipt_category === 'general') {
        catText = 'إيراد عام / أخرى';
        catColor = 'var(--text-secondary)';
      }

      return `
        <tr>
          <td><strong style="color: #fff; font-family: monospace;">${p.receipt_no || ('RC-' + p.id)}</strong></td>
          <td>${p.date || '-'}</td>
          <td><span class="badge" style="background: rgba(255,255,255,0.05); color: ${catColor}; border: 1px solid ${catColor};">${catText}</span></td>
          <td>${p.project_name || '-'}</td>
          <td>${p.bill_no ? `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #facc15;">${p.bill_no}</span>` : '-'}</td>
          <td style="font-weight: 700; color: var(--accent-green);">+${this.formatNumber(p.amount)} ${curr}</td>
          <td>${p.payment_method || 'نقدي'}</td>
          <td style="font-size: 0.75rem; color: var(--text-secondary); max-width: 200px;">${p.notes || '-'}</td>
        </tr>
      `;
    }).join('');
  },

  renderChainRetentionTable(chain, curr) {
    const tbody = document.getElementById('chainRetentionTableBody');
    if (!tbody) return;

    const billsWithRetention = (chain.bills || []).filter(b => Number(b.retention_deduction) > 0);

    if (billsWithRetention.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد محتجزات ضمان مستقطعة مسجلة لهذا العميل</td></tr>`;
      return;
    }

    const totalReleased = Number(chain.financial_summary?.total_retention_released || 0);

    tbody.innerHTML = billsWithRetention.map(b => {
      const held = Number(b.retention_deduction || 0);

      return `
        <tr>
          <td><strong>مستخلص ${b.bill_no}</strong></td>
          <td>${b.project_name || '-'}</td>
          <td>${b.date || '-'}</td>
          <td style="color: #f59e0b; font-weight: 700;">${this.formatNumber(held)} ${curr}</td>
          <td style="color: var(--accent-green);">${this.formatNumber(0)} ${curr}</td>
          <td style="font-weight: 800; color: #f59e0b;">${this.formatNumber(held)} ${curr}</td>
          <td><span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b;">قيد الاحتجاز والضمان</span></td>
        </tr>
      `;
    }).join('');
  },

  switchChainTab(tabName) {
    const tabs = ['hierarchy', 'bills', 'receipts', 'retention'];
    tabs.forEach(t => {
      const btn = document.getElementById(`chainTabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
      const content = document.getElementById(`chainTabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (btn) btn.classList.toggle('active', t === tabName);
      if (content) content.style.display = (t === tabName) ? 'block' : 'none';
    });
  },

  async syncClientBalance(clientId) {
    try {
      this.showToast('جاري تدقيق ومزامنة حساب العميل لحظياً... ⏳', 'info');
      const res = await fetch(`/api/clients/${clientId}/sync-balance`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        this.showToast('تمت مطابقة وتحديث رصيد العميل بنجاح (Zero Drift) ✅', 'success');
        this.loadClientsTable();
      } else {
        this.showToast('فشل في مزامنة الرصيد', 'error');
      }
    } catch (e) {
      this.showToast('خطأ في الاتصال بالخادم', 'error');
    }
  },

  async syncCurrentClientChain() {
    if (!this.currentChainClientId) return;
    await this.syncClientBalance(this.currentChainClientId);
    await this.openClientChainModal(this.currentChainClientId);
  },

  openNewProjectForClientFromChain() {
    if (!this.currentChainClientId) return;
    const clientId = this.currentChainClientId;
    this.closeModal('clientChainModal');
    this.navigate('projects');
    setTimeout(() => {
      if (typeof Projects !== 'undefined' && Projects.openNewModal) {
        Projects.openNewModal(clientId);
      }
    }, 250);
  },

  openNewClientBillFromChain() {
    if (!this.currentChainClientId) return;
    this.openNewClientBillModal(this.currentChainClientId);
  },

  async openReceiptForClientFromChain() {
    if (!this.currentChainClientId) return;
    const clientId = this.currentChainClientId;
    const client = this.currentChainData?.client;
    this.closeModal('clientChainModal');
    if (typeof Accounting !== 'undefined') {
      const openFn = Accounting.openNewReceiptModal || Accounting.openReceiptModal;
      if (openFn) {
        await openFn.call(Accounting, {
          client_id: clientId,
          client_name: client?.name,
          category: 'bill_collection'
        });
      }
    }
  },

  async openClientStatementFromChain() {
    if (!this.currentChainClientId) return;
    const clientId = this.currentChainClientId;
    this.closeModal('clientChainModal');
    if (typeof Reports !== 'undefined' && Reports.showClientStatement) {
      await Reports.showClientStatement(clientId);
    } else {
      await this.navigate('reports');
      if (typeof Reports !== 'undefined') {
        Reports.switchReportTab('client-statement');
        if (Reports.initClientStatementDropdown) {
          await Reports.initClientStatementDropdown(clientId);
        }
        await Reports.fetchFullClientStatement(clientId);
      }
    }
  },

  async quickCollectForBill(billId, clientId, projectId, remainingAmount, billNo) {
    this.closeModal('clientChainModal');
    if (typeof Accounting !== 'undefined') {
      const openFn = Accounting.openNewReceiptModal || Accounting.openReceiptModal;
      if (openFn) {
        const client = (this.clientsFullList || []).find(c => c.id == clientId) || this.currentChainData?.client;
        await openFn.call(Accounting, {
          client_id: clientId,
          client_name: client?.name,
          project_id: projectId,
          category: 'bill_collection',
          bill_id: billId,
          amount: (remainingAmount > 0 ? remainingAmount : null),
          notes: `تحصيل دفعة من مستخلص أعمال رقم ${billNo || billId}`
        });
      }
    }
  },

  // ============================================================================
  // نافذة إصدار مستخلص جديد مرتبط بالسلسلة
  // ============================================================================

  async openNewClientBillModal(clientId, contractId, projectId) {
    this.openModal('newClientBillModal');

    // رقم تلقائي
    const autoNo = `BILL-${Date.now().toString().slice(-4)}`;
    const autoNoEl = document.getElementById('newBillAutoNo');
    if (autoNoEl) autoNoEl.innerText = autoNo;

    const dateInput = document.getElementById('modalBillDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // تعبئة قائمة العملاء
    const clientSelect = document.getElementById('modalBillClientSelect');
    if (clientSelect) {
      clientSelect.innerHTML = '<option value="">اختر العميل...</option>' + 
        (this.clientsFullList || []).map(c => `<option value="${c.id}" ${c.id == clientId ? 'selected' : ''}>${c.name} (${c.company || 'فردي'})</option>`).join('');
    }

    await this.onBillClientChange(clientId || clientSelect?.value);

    if (projectId) {
      const prjSelect = document.getElementById('modalBillProjectSelect');
      if (prjSelect) prjSelect.value = projectId;
      await this.onBillProjectChange(projectId);
    }

    if (contractId) {
      const cSelect = document.getElementById('modalBillContractSelect');
      if (cSelect) cSelect.value = contractId;
      this.onBillContractChange(contractId);
    }

    this.calcNewBillValues();
  },

  async onBillClientChange(clientId) {
    if (!clientId) return;
    try {
      // جلب عقود ومشاريع هذا العميل
      const [contractsRes, projectsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/contracts`),
        fetch(`/api/projects`)
      ]);
      const contractsJson = await contractsRes.json();
      const projectsJson = await projectsRes.json();

      this.billModalContracts = contractsJson.data || [];
      const allProjects = projectsJson.data || [];
      // المشاريع المرتبطة بالعميل
      this.billModalProjects = allProjects.filter(p => p.client_id == clientId || this.billModalContracts.some(c => c.project_id == p.id));

      const prjSelect = document.getElementById('modalBillProjectSelect');
      if (prjSelect) {
        prjSelect.innerHTML = '<option value="">اختر المشروع...</option>' + 
          this.billModalProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      }

      const cSelect = document.getElementById('modalBillContractSelect');
      if (cSelect) {
        cSelect.innerHTML = '<option value="">بدون عقد محدد...</option>' + 
          this.billModalContracts.map(c => `<option value="${c.id}">عقد: ${c.contract_no || c.id} (قيمة: ${this.formatNumber(c.contract_value)})</option>`).join('');
      }
    } catch (e) {
      console.error('Error on bill client change:', e);
    }
  },

  async onBillProjectChange(projectId) {
    if (!projectId) {
      this.currentBillProjectMetrics = null;
      return;
    }
    // مطابقة العقد تلقائياً إذا كان للمشروع عقد
    const matchedContract = (this.billModalContracts || []).find(c => c.project_id == projectId);
    const cSelect = document.getElementById('modalBillContractSelect');
    if (cSelect && matchedContract) {
      cSelect.value = matchedContract.id;
      this.onBillContractChange(matchedContract.id);
    }

    // جلب مقاييس المشروع وحاسبة الإنجاز التفاعلية
    try {
      const res = await fetch(`/api/projects/${projectId}/control-metrics`);
      const json = await res.json();
      if (json.success && json.data) {
        this.currentBillProjectMetrics = json.data;
        const financials = json.data.financials || {};
        const p = json.data.project || {};
        const contractVal = Number(financials.contract_value) || Number(p.contract_value) || 0;
        const curr = p.currency || 'ر.ي';
        const prevProg = Number(p.progress_percentage) || 0;
        const totalGrossBilled = Number(financials.total_gross_billed) || 0;

        const valBadge = document.getElementById('modalBillContractValBadge');
        if (valBadge) valBadge.innerText = `قيمة العقد: ${this.formatNumber(contractVal)} ${curr}`;

        const prevProgEl = document.getElementById('modalBillPrevProgressPct');
        if (prevProgEl) prevProgEl.innerText = `${prevProg}%`;

        const prevBilledEl = document.getElementById('modalBillPrevBilledAmt');
        if (prevBilledEl) prevBilledEl.innerText = `(إجمالي سابق: ${this.formatNumber(totalGrossBilled)})`;

        const slider = document.getElementById('modalBillProgressSlider');
        const input = document.getElementById('modalBillProgressInput');
        const targetLabel = document.getElementById('modalBillTargetProgressLabel');
        if (slider) slider.value = prevProg;
        if (input) input.value = prevProg;
        if (targetLabel) targetLabel.innerText = `${prevProg}%`;

        const calcWorkEl = document.getElementById('modalBillCalculatedWorkAmt');
        if (calcWorkEl) calcWorkEl.innerText = '0';
      }
    } catch (err) {
      console.warn('Error fetching project control metrics for bill:', err);
    }
  },

  onBillProgressSliderChange(val) {
    const input = document.getElementById('modalBillProgressInput');
    if (input) input.value = val;
    this.updateBillFromProgress(parseFloat(val) || 0);
  },

  onBillProgressInputChange(val) {
    const slider = document.getElementById('modalBillProgressSlider');
    if (slider) slider.value = val;
    this.updateBillFromProgress(parseFloat(val) || 0);
  },

  updateBillFromProgress(newProg) {
    const targetLabel = document.getElementById('modalBillTargetProgressLabel');
    if (targetLabel) targetLabel.innerText = `${newProg}%`;

    const metrics = this.currentBillProjectMetrics;
    const contractVal = metrics ? (Number(metrics.financials?.contract_value) || Number(metrics.project?.contract_value) || 0) : 0;
    const prevGrossBilled = metrics ? (Number(metrics.financials?.total_gross_billed) || 0) : 0;

    let workAmount = 0;
    if (contractVal > 0) {
      // احتساب القيمة المكتسبة التراكمية وطرح المفوتر سابقاً للحصول على أعمال الفترة
      const cumulativeValue = Math.round((contractVal * (newProg / 100)) * 100) / 100;
      workAmount = Math.max(0, Math.round(cumulativeValue - prevGrossBilled));
    }

    const calcWorkEl = document.getElementById('modalBillCalculatedWorkAmt');
    if (calcWorkEl) calcWorkEl.innerText = `${this.formatNumber(workAmount)}`;

    const grossInput = document.getElementById('modalBillGrossAmount');
    if (grossInput && workAmount > 0) {
      grossInput.value = workAmount;
      this.calcNewBillValues();
    }
  },

  onBillContractChange(contractId) {
    const contract = (this.billModalContracts || []).find(c => c.id == contractId);
    const advPct = contract?.advance_payment_pct !== undefined ? contract.advance_payment_pct : 10;
    const retPct = contract?.retention_pct !== undefined ? contract.retention_pct : 10;

    const advLabel = document.getElementById('modalBillAdvPctLabel');
    if (advLabel) advLabel.innerText = advPct;
    const retLabel = document.getElementById('modalBillRetPctLabel');
    if (retLabel) retLabel.innerText = retPct;

    this.calcNewBillValues();
  },

  calcNewBillValues(manual = false) {
    const gross = Number(document.getElementById('modalBillGrossAmount')?.value) || 0;
    const contractId = document.getElementById('modalBillContractSelect')?.value;
    const contract = (this.billModalContracts || []).find(c => c.id == contractId);

    const advPct = contract?.advance_payment_pct !== undefined ? Number(contract.advance_payment_pct) : 10;
    const retPct = contract?.retention_pct !== undefined ? Number(contract.retention_pct) : 10;

    let advDed = Number(document.getElementById('modalBillAdvanceDeduction')?.value) || 0;
    let retDed = Number(document.getElementById('modalBillRetentionDeduction')?.value) || 0;
    const otherDed = Number(document.getElementById('modalBillOtherDeduction')?.value) || 0;

    if (!manual && gross > 0) {
      advDed = Math.round((gross * advPct) / 100);
      retDed = Math.round((gross * retPct) / 100);
      const advInput = document.getElementById('modalBillAdvanceDeduction');
      if (advInput) advInput.value = advDed;
      const retInput = document.getElementById('modalBillRetentionDeduction');
      if (retInput) retInput.value = retDed;
    }

    const net = Math.max(0, gross - advDed - retDed - otherDed);
    const netInput = document.getElementById('modalBillNetAmount');
    if (netInput) netInput.value = net;
  },

  async submitNewClientBill(e) {
    e.preventDefault();
    const autoNo = document.getElementById('newBillAutoNo')?.innerText || `BILL-${Date.now().toString().slice(-4)}`;
    const clientId = document.getElementById('modalBillClientSelect')?.value;
    const projectId = document.getElementById('modalBillProjectSelect')?.value;
    const contractId = document.getElementById('modalBillContractSelect')?.value;
    const date = document.getElementById('modalBillDate')?.value;
    const gross = Number(document.getElementById('modalBillGrossAmount')?.value) || 0;
    const advDed = Number(document.getElementById('modalBillAdvanceDeduction')?.value) || 0;
    const retDed = Number(document.getElementById('modalBillRetentionDeduction')?.value) || 0;
    const otherDed = Number(document.getElementById('modalBillOtherDeduction')?.value) || 0;
    const net = Number(document.getElementById('modalBillNetAmount')?.value) || (gross - advDed - retDed - otherDed);
    const notes = document.getElementById('modalBillNotes')?.value;

    const autoProgress = document.getElementById('modalBillAutoUpdateProjectProgress')?.checked;
    const progressPct = parseFloat(document.getElementById('modalBillProgressInput')?.value) || 0;

    if (!clientId || !projectId || gross <= 0) {
      this.showToast('يرجى اختيار العميل والمشروع وإدخال إجمالي الأعمال', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_no: autoNo,
          bill_type: 'مستخلص أعمال جاري',
          client_id: Number(clientId),
          project_id: Number(projectId),
          contract_id: contractId ? Number(contractId) : null,
          gross_amount: gross,
          advance_deduction: advDed,
          retention_deduction: retDed,
          deduction: advDed + retDed + otherDed,
          net_amount: net,
          amount: gross,
          date,
          status: 'معتمد',
          notes,
          progress_percentage: autoProgress ? progressPct : undefined
        })
      });

      const json = await res.json();
      if (json.success) {
        this.showToast(`تم إصدار المستخلص بنجاح (${autoNo}) وتحديث رصيد العميل ونسبة الإنجاز آلياً 📑`, 'success');
        this.closeModal('newClientBillModal');
        this.loadClientsTable();

        // تحديث جدول المشاريع فورياً
        if (typeof Projects !== 'undefined' && Projects.loadProjects) {
          Projects.loadProjects();
        }

        // إذا كانت نافذة السلسلة مفتوحة، نقوم بتحديثها فوراً
        if (this.currentChainClientId == clientId) {
          this.openClientChainModal(clientId);
        }
      } else {
        this.showToast(json.message || 'فشل في حفظ المستخلص', 'error');
      }
    } catch (err) {
      console.error('Error creating client bill:', err);
      this.showToast('خطأ في الاتصال بالخادم أثناء حفظ المستخلص', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.App = App;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}

// تشغيل التطبيق عند اكتمال تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
