/**
 * js/project_closeout.js
 * 
 * وحدة إغلاق المشروع وتقارير التحليلات بنمط CQRS - شركة رواسي عدن للهندسة والمقاولات
 * يطبق فصلاً تاماً بين:
 *  1. مستخلص العميل الخارجي (Client BoQ): معقم وخالي من أي تسريب للتكاليف أو الهدر.
 *  2. مستخلص الرقابة والتدقيق الداخلي (Internal Audit BoQ): يتتبع دورة حياة المواد السبعة:
 *     (BaselineQuantity, PurchasedQuantity, ReceivedQuantity, IssuedQuantity, ConsumedQuantity, SiteStockBalance, RemainingBaseline)
 *     وانحرافات التكلفة والهدر وهوامش الربحية.
 */

const ProjectCloseout = {
  projects: [],
  selectedProjectId: null,
  activeModelTab: 'internal', // 'client' | 'internal'
  currentData: null,

  async init() {
    await this.loadProjects();
  },

  async loadProjects() {
    try {
      const res = await fetch('/api/projects');
      const json = await res.json();
      if (json.success && json.data) {
        this.projects = json.data;
        this.renderProjectSelector();
        if (this.projects.length > 0 && !this.selectedProjectId) {
          await this.selectProject(this.projects[0].id);
        }
      }
    } catch (e) {
      console.error('Error loading projects for closeout:', e);
    }
  },

  renderProjectSelector() {
    const sel = document.getElementById('closeoutProjectSelect');
    if (!sel) return;

    sel.innerHTML = this.projects.map(p => `
      <option value="${p.id}" ${p.id === this.selectedProjectId ? 'selected' : ''}>
        ${p.name} (${p.status === 'completed' || p.status === 'closed' ? '🔒 مغلق' : '🟢 نشط'})
      </option>
    `).join('');
  },

  async onProjectChange(projectId) {
    await this.selectProject(Number(projectId));
  },

  async selectProject(projectId) {
    this.selectedProjectId = projectId;
    await this.loadProjectCloseoutData(projectId);
  },

  async loadProjectCloseoutData(projectId) {
    const loadingEl = document.getElementById('closeoutLoadingIndicator');
    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const res = await fetch(`/api/project-closeout/${projectId}/preview`);
      const json = await res.json();
      if (json.success && json.data) {
        this.currentData = json.data;
        this.renderHeaderAndKPIs();
        this.renderActiveTabTable();
      } else {
        App.showToast(json.message || 'فشل في تحميل بيانات إغلاق المشروع', 'error');
      }
    } catch (e) {
      console.error('Error fetching closeout preview:', e);
      App.showToast('خطأ في الاتصال بالخادم', 'error');
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  },

  switchModelTab(tabKey) {
    this.activeModelTab = tabKey;
    const clientBtn = document.getElementById('tabBtn-clientBoq');
    const auditBtn = document.getElementById('tabBtn-auditBoq');
    const clientPane = document.getElementById('pane-clientBoq');
    const auditPane = document.getElementById('pane-auditBoq');

    if (tabKey === 'client') {
      if (clientBtn) clientBtn.className = 'btn btn-primary';
      if (auditBtn) auditBtn.className = 'btn btn-secondary';
      if (clientPane) clientPane.style.display = 'block';
      if (auditPane) auditPane.style.display = 'none';
    } else {
      if (clientBtn) clientBtn.className = 'btn btn-secondary';
      if (auditBtn) auditBtn.className = 'btn btn-primary';
      if (clientPane) clientPane.style.display = 'none';
      if (auditPane) auditPane.style.display = 'block';
    }

    this.renderActiveTabTable();
  },

  renderHeaderAndKPIs() {
    if (!this.currentData) return;
    const { summary, clientBoq, auditBoq } = this.currentData;
    const isClosed = summary.is_closed;

    // حالة المشروع والبادج
    const statusBadge = document.getElementById('closeoutStatusBadge');
    if (statusBadge) {
      if (isClosed) {
        statusBadge.className = 'badge badge-success';
        statusBadge.innerHTML = `🔒 مغلق ومسَلَّم نهائياً (${summary.closeout_record?.closeout_no || ''})`;
      } else {
        statusBadge.className = 'badge badge-warning';
        statusBadge.innerHTML = '🟢 قيد التنفيذ النشط (معاينة حية للمستخلصات)';
      }
    }

    // أزرار التحكم
    const closeBtn = document.getElementById('btnDoCloseProject');
    const reopenBtn = document.getElementById('btnDoReopenProject');
    if (closeBtn) closeBtn.style.display = isClosed ? 'none' : 'inline-flex';
    if (reopenBtn) reopenBtn.style.display = isClosed ? 'inline-flex' : 'none';

    // تعبئة بطاقات المؤشرات التنفيذية (KPI Cards)
    const fin = summary.financials;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('kpiCloseoutContractVal', `${App.formatNumber(fin.total_contract_value)} ر.ي`);
    setTxt('kpiCloseoutBilledVal', `${App.formatNumber(fin.total_billed_amount)} ر.ي`);
    setTxt('kpiCloseoutActualCost', `${App.formatNumber(fin.total_actual_cost)} ر.ي`);

    const profitEl = document.getElementById('kpiCloseoutGrossProfit');
    if (profitEl) {
      profitEl.textContent = `${App.formatNumber(fin.gross_profit)} ر.ي (${fin.profit_margin_percent}%)`;
      profitEl.style.color = fin.gross_profit >= 0 ? 'var(--accent-green, #27ae60)' : 'var(--accent-red, #c0392b)';
    }

    setTxt('kpiCloseoutSiteStockVal', `${App.formatNumber(fin.site_stock_value)} ر.ي`);
    setTxt('kpiCloseoutWastageVal', `${App.formatNumber(fin.total_wastage_cost)} ر.ي`);
    setTxt('kpiCloseoutRetentionVal', `${App.formatNumber(fin.retention_amount)} ر.ي`);
    setTxt('kpiCloseoutNetPayableVal', `${App.formatNumber(fin.net_client_payable)} ر.ي`);
  },

  renderActiveTabTable() {
    if (!this.currentData) return;
    if (this.activeModelTab === 'client') {
      this.renderClientBoQTable();
    } else {
      this.renderInternalAuditBoQTable();
    }
  },

  // =========================================================================
  // 1. عرض مستخلص العميل الخارجي (Client BoQ Table)
  // =========================================================================
  renderClientBoQTable() {
    const tbody = document.getElementById('clientBoqTableBody');
    if (!tbody || !this.currentData?.clientBoq) return;

    const { items, totals } = this.currentData.clientBoq;
    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px;">لا توجد بنود مسجلة في جدول الكميات</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(it => `
      <tr>
        <td style="font-weight: 700;">${it.item_no}</td>
        <td>
          <div style="font-weight: 600; color: var(--text-primary);">${it.description}</div>
          <small style="color: var(--text-secondary);">${it.category || '-'}</small>
        </td>
        <td><span class="badge badge-secondary">${it.unit}</span></td>
        <td style="text-align: center; font-weight: 600;">${App.formatNumber(it.contract_qty)}</td>
        <td style="text-align: center; font-weight: 700; color: var(--accent-blue, #2980b9);">${App.formatNumber(it.billed_qty)}</td>
        <td style="text-align: right;">${App.formatNumber(it.contract_unit_rate)} ر.ي</td>
        <td style="text-align: right; font-weight: 700; color: var(--text-primary);">${App.formatNumber(it.billable_amount)} ر.ي</td>
        <td style="text-align: right; color: var(--accent-red, #c0392b);">-${App.formatNumber(it.retention_amount)} ر.ي</td>
        <td style="text-align: right; font-weight: 800; color: var(--accent-green, #27ae60);">${App.formatNumber(it.net_payable)} ر.ي</td>
      </tr>
    `).join('');

    // تحديث أرقام التذييل
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt('clientFooterTotalBilled', `${App.formatNumber(totals.total_billed)} ر.ي`);
    setTxt('clientFooterRetention', `-${App.formatNumber(totals.retention_amount)} ر.ي`);
    setTxt('clientFooterNetPayable', `${App.formatNumber(totals.net_payable)} ر.ي`);
  },

  // =========================================================================
  // 2. عرض مستخلص الرقابة والتدقيق الداخلي (Internal Audit BoQ Table)
  // =========================================================================
  renderInternalAuditBoQTable() {
    const tbody = document.getElementById('auditBoqTableBody');
    if (!tbody || !this.currentData?.auditBoq) return;

    const { items, summary } = this.currentData.auditBoq;
    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 20px;">لا توجد بنود مسجلة للتدقيق</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(it => {
      // شارة الحالة الرقابية
      let statusBadge = `<span class="badge badge-success">✓ مطابق</span>`;
      if (it.VarianceStatus === 'COST_OVERRUN') {
        statusBadge = `<span class="badge badge-danger">⚠️ عجز تكلفة</span>`;
      } else if (it.VarianceStatus === 'HIGH_WASTAGE') {
        statusBadge = `<span class="badge badge-warning">☣️ هدر مرتفع</span>`;
      } else if (it.VarianceStatus === 'SURPLUS_AT_SITE') {
        statusBadge = `<span class="badge badge-info">📦 فائض بالموقع</span>`;
      }

      const costVarColor = it.CostVariance >= 0 ? '#27ae60' : '#c0392b';
      const marginColor = it.GrossProfit >= 0 ? '#27ae60' : '#c0392b';

      return `
        <tr>
          <td style="font-weight: 700;">${it.item_no}</td>
          <td>
            <div style="font-weight: 600; font-size: 0.9rem;">${it.item_name}</div>
            <small style="color: var(--text-secondary);">${it.category}</small>
          </td>
          <td><span class="badge badge-secondary">${it.unit}</span></td>
          
          <!-- الحقول السبعة الأساسية المطلوبة نصاً -->
          <!-- 1. BaselineQuantity -->
          <td style="text-align: center; font-weight: 700; background: rgba(52, 152, 219, 0.05);">${App.formatNumber(it.BaselineQuantity)}</td>
          <!-- 2. PurchasedQuantity -->
          <td style="text-align: center;">${App.formatNumber(it.PurchasedQuantity)}</td>
          <!-- 3. ReceivedQuantity -->
          <td style="text-align: center;">${App.formatNumber(it.ReceivedQuantity)}</td>
          <!-- 4. IssuedQuantity -->
          <td style="text-align: center; font-weight: 600; color: #d35400;">${App.formatNumber(it.IssuedQuantity)}</td>
          <!-- 5. ConsumedQuantity -->
          <td style="text-align: center; font-weight: 700; color: #27ae60;">${App.formatNumber(it.ConsumedQuantity)}</td>
          <!-- 6. SiteStockBalance = Issued - Consumed -->
          <td style="text-align: center; font-weight: 700; color: ${it.SiteStockBalance > 0 ? '#2980b9' : 'inherit'}; background: rgba(41, 128, 185, 0.08);">
            ${App.formatNumber(it.SiteStockBalance)}
            ${it.SiteStockBalance > 0 ? '<small style="display:block; font-size:0.7rem; color:#2980b9;">فائض موقع</small>' : ''}
          </td>
          <!-- 7. RemainingBaseline = Baseline - Consumed -->
          <td style="text-align: center; font-weight: 600; color: ${it.RemainingBaseline > 0 ? '#7f8c8d' : '#27ae60'};">
            ${App.formatNumber(it.RemainingBaseline)}
          </td>

          <!-- الهدر والتالف -->
          <td style="text-align: center; color: ${it.WastageQuantity > 0 ? '#c0392b' : 'inherit'};">
            ${App.formatNumber(it.WastageQuantity)}
            ${it.WastagePercent > 0 ? `<small style="display:block; font-size:0.75rem; color:#c0392b;">(${it.WastagePercent}%)</small>` : ''}
          </td>

          <!-- التكلفة الفعلية والتباين -->
          <td style="text-align: right; font-weight: 600;">${App.formatNumber(it.TotalActualCost)} ر.ي</td>
          <td style="text-align: right; font-weight: 700; color: ${costVarColor};">
            ${it.CostVariance > 0 ? '+' : ''}${App.formatNumber(it.CostVariance)} ر.ي
          </td>

          <!-- الربحية والمركز المالي -->
          <td style="text-align: right; font-weight: 800; color: ${marginColor};">
            ${App.formatNumber(it.GrossProfit)} ر.ي
            <small style="display: block; font-size: 0.75rem; color: ${marginColor};">${it.ProfitMarginPercent}%</small>
          </td>

          <!-- الشارة الرقابية -->
          <td style="text-align: center;">${statusBadge}</td>
        </tr>
      `;
    }).join('');
  },

  // =========================================================================
  // 3. أوامر الإغلاق وإعادة الفتح التفاعلية (Commands UI)
  // =========================================================================

  openCloseProjectModal() {
    if (!this.selectedProjectId || !this.currentData) return;
    const { project, summary } = this.currentData;

    const modalContent = `
      <form id="closeProjectCommandForm" onsubmit="ProjectCloseout.submitCloseProject(event)">
        <div style="background: rgba(231, 76, 60, 0.08); border-right: 4px solid #e74c3c; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
          <h4 style="margin: 0 0 6px 0; color: #c0392b;">تأكيد الإغلاق النهائي للمشروع وتثبيت نماذج القراءة (CQRS Closeout)</h4>
          <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary);">
            عند تنفيذ هذا الأمر، سيقوم النظام بالتحقق الذري من كافة الحسابات، وتحويل حالة المشروع إلى (مكتمل / مغلق)،
            وتوليد نسختين ماديتين غير قابلتين للتعديل لجدول الكميات (نسخة العميل التعاقدية ونسخة الرقابة الداخلية الشاملة).
          </p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
          <div style="background: var(--bg-surface-2, #f8f9fa); padding: 10px; border-radius: 6px;">
            <span style="font-size: 0.8rem; color: var(--text-secondary);">المشروع:</span>
            <div style="font-weight: 700; margin-top: 2px;">${project.name}</div>
          </div>
          <div style="background: var(--bg-surface-2, #f8f9fa); padding: 10px; border-radius: 6px;">
            <span style="font-size: 0.8rem; color: var(--text-secondary);">إجمالي الإيراد المنفذ:</span>
            <div style="font-weight: 700; margin-top: 2px; color: var(--accent-green, #27ae60);">${App.formatNumber(summary.financials.total_billed_amount)} ر.ي</div>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">تاريخ الإغلاق والتسليم النهائي:</label>
          <input type="date" id="cpCloseDate" class="form-control" required value="${new Date().toISOString().split('T')[0]}" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">اسم المسؤول المعتمد للإغلاق:</label>
          <input type="text" id="cpClosedBy" class="form-control" required placeholder="اسم مدير المشاريع أو الإدارة الهندسية" value="م. مدير إدارة المشاريع" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">ملاحظات وقرارات لجنة التسليم النهائي:</label>
          <textarea id="cpNotes" class="form-control" rows="2" placeholder="تم استيفاء كافة الأعمال وتسليم الموقع للجهة المالكة وتثبيت الأرصدة والمستخلصات" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);"></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-primary" style="background: #c0392b; border-color: #a93226;">تأكيد الإغلاق وتوليد نماذج القراءة 🔒</button>
        </div>
      </form>
    `;

    App.showDynamicModal('إغلاق المشروع النهائي والاعتماد CQRS', modalContent);
  },

  async submitCloseProject(e) {
    e.preventDefault();
    const projectId = this.selectedProjectId;
    const closeoutDate = document.getElementById('cpCloseDate').value;
    const closedByName = document.getElementById('cpClosedBy').value.trim();
    const notes = document.getElementById('cpNotes').value.trim();

    try {
      const res = await fetch(`/api/project-closeout/close/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closeout_date: closeoutDate, closed_by_name: closedByName, notes, force_close: true })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم إغلاق المشروع بنجاح (${data.data.closeoutNo}) وتوليد نماذج القراءة المادية`, 'success');
        App.closeModal('dynamicAppModal');
        await this.loadProjects();
        await this.selectProject(projectId);
      } else {
        App.showToast(data.message || 'خطأ في تنفيذ الإغلاق', 'error');
      }
    } catch (e) {
      App.showToast('فشل في إغلاق المشروع', 'error');
    }
  },

  openReopenProjectModal() {
    if (!this.selectedProjectId) return;
    const reason = prompt('يرجى كتابة سبب استدراك وإعادة فتح المشروع:');
    if (!reason) return;

    this.submitReopenProject(reason);
  },

  async submitReopenProject(reason) {
    try {
      const res = await fetch(`/api/project-closeout/reopen/${this.selectedProjectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadProjects();
        await this.selectProject(this.selectedProjectId);
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في إعادة فتح المشروع', 'error');
    }
  },

  // =========================================================================
  // دوال الطباعة المعيارية الرسمية (Official CQRS Printable Reports)
  // =========================================================================
  getPrintBaseConfig(title, docRef) {
    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      sig1: 'مهندس المشروع',
      sig2: 'الإدارة المالية',
      sig3: 'المدير العام',
      footer_notes: 'تعتبر هذه الوثيقة معتمدة ورسمية ومحمية بحقوق شركة رواسي عدن للهندسة والمقاولات'
    };

    const todayDate = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = (typeof Settings !== 'undefined' && Settings.getCurrentUserName)
      ? Settings.getCurrentUserName()
      : ((typeof Auth !== 'undefined' && Auth.currentUser) ? (Auth.currentUser.full_name || Auth.currentUser.username) : 'علوي محمد باعبيد');

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`${title} - ${docRef || ''}`);
    }

    const headerHtml = (typeof Settings !== 'undefined' && Settings.renderReportHeader)
      ? Settings.renderReportHeader(title, [
          { label: 'رقم الوثيقة', val: docRef || 'DOC' },
          { label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` },
          { label: 'المستخدم المسؤول', val: userName }
        ], cfg)
      : `
        <div style="text-align: center; margin-bottom: 16px; border-bottom: 2px solid #0f2744; padding-bottom: 12px;">
          <h2 style="margin: 0; color: #0f2744; font-size: 1.3rem;">${cfg.header_title}</h2>
          <div style="font-size: 0.85rem; color: #64748b; margin-top: 3px;">${cfg.header_subtitle}</div>
          <h3 style="margin: 10px 0 4px 0; color: #b8911c; font-size: 1.1rem;">${title}</h3>
          <div style="font-size: 0.8rem; color: #334155;">رقم المستند: ${docRef} | تاريخ الطباعة: ${todayDate} ${timeStr} | المستخدم: ${userName}</div>
        </div>
      `;

    const footerHtml = (typeof Settings !== 'undefined' && Settings.renderReportFooter)
      ? Settings.renderReportFooter(cfg)
      : `<div style="text-align: center; font-size: 0.75rem; color: #64748b; margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 6px;">${cfg.footer_notes} | نظام رواسي عدن المتكامل</div>`;

    return { headerHtml, footerHtml, cfg, userName, todayDate, timeStr };
  },

  setPageOrientation(orientation = 'portrait') {
    let style = document.getElementById('closeoutPrintOrientationStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'closeoutPrintOrientationStyle';
      document.head.appendChild(style);
    }
    if (orientation === 'landscape') {
      style.textContent = `@page { size: A4 landscape !important; margin: 8mm 6mm !important; }`;
    } else {
      style.textContent = `@page { size: A4 portrait !important; margin: 10mm 8mm !important; }`;
    }
  },

  getOrCreatePrintArea() {
    let printArea = document.getElementById('printArea');
    if (!printArea) {
      printArea = document.createElement('div');
      printArea.id = 'printArea';
      printArea.className = 'print-area';
      printArea.style.display = 'none';
      document.body.appendChild(printArea);
    }
    return printArea;
  },

  printCurrentView() {
    if (this.activeModelTab === 'client') {
      this.printClientBoQ();
    } else {
      this.printInternalAuditBoQ();
    }
  },

  printReport(type) {
    if (type === 'client') {
      this.printClientBoQ();
    } else if (type === 'internal') {
      this.printInternalAuditBoQ();
    } else {
      this.printCurrentView();
    }
  },

  // 1. طباعة مستخلص العميل النهائي الخارجي الرسمي
  printClientBoQ() {
    if (!this.currentData || !this.currentData.clientBoq) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('يرجى اختيار مشروع والتأكد من تحميل بيانات المستخلص قبل الطباعة', 'warning');
      } else {
        alert('يرجى اختيار مشروع أولاً');
      }
      return;
    }

    const { clientBoq, summary } = this.currentData;
    const project = clientBoq.project || summary?.project || {};
    const closeout = clientBoq.closeout || summary?.closeout_record || {};
    const items = clientBoq.items || [];
    const totals = clientBoq.totals || {};

    const docNo = closeout.closeout_no || `CLO-${project.code || project.id || 'PRJ'}-FINAL`;
    const docTitle = 'المستخلص الختامي الرسمي المعتمد للأعمال (Client Final BoQ)';
    const { headerHtml, footerHtml, todayDate } = this.getPrintBaseConfig(docTitle, docNo);

    this.setPageOrientation('portrait');
    const printArea = this.getOrCreatePrintArea();

    const curr = project.currency || 'ر.ي';
    const tafqeetText = (typeof window !== 'undefined' && typeof window.Tafqeet === 'function')
      ? window.Tafqeet(totals.total_net_payable || 0, 'ريال يمني')
      : '';

    const itemsRows = items.length === 0 
      ? `<tr><td colspan="9" style="text-align: center; padding: 15px;">لا توجد بنود مسجلة في كشف الكميات</td></tr>`
      : items.map((it, idx) => `
        <tr>
          <td style="text-align: center; font-weight: 700;">${it.item_no || (idx + 1)}</td>
          <td>
            <div style="font-weight: 700; color: #0f2744;">${it.description}</div>
            ${it.category ? `<small style="color: #64748b;">${it.category}</small>` : ''}
          </td>
          <td style="text-align: center;">${it.unit || '-'}</td>
          <td style="text-align: center;">${App.formatNumber(it.contract_qty)}</td>
          <td style="text-align: center; font-weight: 700; color: #0f2744;">${App.formatNumber(it.billed_qty)}</td>
          <td style="text-align: right;">${App.formatNumber(it.contract_unit_rate)}</td>
          <td style="text-align: right; font-weight: 700;">${App.formatNumber(it.billable_amount)}</td>
          <td style="text-align: right; color: #c0392b;">${App.formatNumber(it.retention_amount)}</td>
          <td style="text-align: right; font-weight: 800; color: #15803d;">${App.formatNumber(it.net_payable)}</td>
        </tr>
      `).join('');

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal" style="width: 100%; max-width: 210mm; margin: 0 auto; background: #fff; box-shadow: none;">
        ${headerHtml}

        <div class="report-content-body">
          <!-- بيانات المشروع والتعاقد -->
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.85rem;">
            <tr>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744; width: 32%;">${project.name || '-'} (${project.code || ''})</td>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">الجهة المالكة (العميل):</td>
              <td style="font-weight: 700; width: 32%;">${project.client_name || 'الجهة المالكة'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">قيمة العقد الأصلية:</td>
              <td style="font-weight: 800; color: #b8911c;">${App.formatNumber(totals.total_contract_value)} ${curr}</td>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ الإغلاق والتسليم:</td>
              <td>${closeout.closeout_date || todayDate}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">حالة المستخلص:</td>
              <td><strong style="color: ${closeout.status === 'closed' ? '#15803d' : '#b8911c'};">${closeout.status === 'closed' ? '🔒 معتمد ومغلق نهائياً' : '🟢 مستخلص ختامي قيد المراجعة'}</strong></td>
              <td style="font-weight: 800; background: #f1f5f9;">المسؤول المعتمد:</td>
              <td>${closeout.closed_by_name || 'الإدارة الهندسية'}</td>
            </tr>
            ${closeout.notes ? `
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">ملاحظات الاستلام:</td>
              <td colspan="3" style="font-size: 0.82rem; color: #334155;">${closeout.notes}</td>
            </tr>` : ''}
          </table>

          <!-- جدول بنود الأعمال المنفذة للعميل -->
          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 12px 0 6px 0; border-right: 3px solid #d4af37; padding-right: 8px;">
            كشف الكميات والأعمال المنفذة المعتمدة للفوترة
          </div>
          <table class="official-report-table" style="font-size: 0.82rem; margin-bottom: 12px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="width: 6%;">بند</th>
                <th style="width: 32%;">بيان الأعمال التعاقدية المعتمدة</th>
                <th style="width: 8%;">الوحدة</th>
                <th style="width: 9%;">الكمية التعاقدية</th>
                <th style="width: 9%;">الكمية المنفذة</th>
                <th style="width: 10%;">سعر الفئة (${curr})</th>
                <th style="width: 12%;">إجمالي المستحق</th>
                <th style="width: 10%; color: #c0392b;">الضمان (5%)</th>
                <th style="width: 12%; color: #15803d;">صافي المستحق</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
            <tfoot>
              <tr style="background: #f8fafc; font-weight: 800;">
                <td colspan="6" style="text-align: left; font-size: 0.9rem;">الإجمالي العام للمستخلص الختامي:</td>
                <td style="text-align: right; color: #0f2744;">${App.formatNumber(totals.total_billed_amount)}</td>
                <td style="text-align: right; color: #c0392b;">${App.formatNumber(totals.total_retention_amount)}</td>
                <td style="text-align: right; color: #15803d; font-size: 0.95rem;">${App.formatNumber(totals.total_net_payable)}</td>
              </tr>
            </tfoot>
          </table>

          <!-- بطاقة الصافي والتفقيط -->
          <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="font-size: 0.8rem; color: #15803d; font-weight: 700;">صافي المبلغ المستحق صرفه للمقاول:</div>
              <div style="font-size: 1.25rem; font-weight: 900; color: #15803d; margin-top: 2px;">${App.formatNumber(totals.total_net_payable)} ${curr}</div>
              ${tafqeetText ? `<div style="font-size: 0.8rem; color: #334155; margin-top: 2px;">(فقط ${tafqeetText} لا غير)</div>` : ''}
            </div>
            <div style="text-align: left; font-size: 0.8rem; color: #64748b;">
              <div>قيمة الأعمال المنفذة: <strong>${App.formatNumber(totals.total_billed_amount)} ${curr}</strong></div>
              <div>محتجز ضمان الأعمال (5%): <strong>${App.formatNumber(totals.total_retention_amount)} ${curr}</strong></div>
            </div>
          </div>

          <!-- توقيعات الاعتماد الرسمي -->
          <div class="letterhead-signatures-row" style="margin-top: 24px; padding-top: 15px; border-top: 1px solid #cbd5e1;">
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.8rem; color: #0f2744; margin-bottom: 35px;">مهندس الموقع / المشروع</div>
              <div style="font-size: 0.78rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">التوقيع: .....................</div>
            </div>
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.8rem; color: #0f2744; margin-bottom: 35px;">المهندس الاستشاري المشرف</div>
              <div style="font-size: 0.78rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">التوقيع: .....................</div>
            </div>
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.8rem; color: #0f2744; margin-bottom: 35px;">الجهة المالكة / العميل</div>
              <div style="font-size: 0.78rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">الاعتماد: .....................</div>
            </div>
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.8rem; color: #0f2744; margin-bottom: 35px;">المدير العام لشركة رواسي عدن</div>
              <div style="font-size: 0.78rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">الختم والتوقيع: .....................</div>
            </div>
          </div>
        </div>

        ${footerHtml}
      </div>
    `;

    printArea.style.display = 'block';
    setTimeout(() => {
      window.print();
    }, 150);
  },

  // 2. طباعة تقرير الرقابة والتدقيق الداخلي الشامل لدورة حياة المواد
  printInternalAuditBoQ() {
    if (!this.currentData || !this.currentData.auditBoq) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('يرجى اختيار مشروع والتأكد من تحميل بيانات التدقيق قبل الطباعة', 'warning');
      } else {
        alert('يرجى اختيار مشروع أولاً');
      }
      return;
    }

    const { auditBoq, summary } = this.currentData;
    const project = auditBoq.project || summary?.project || {};
    const closeout = auditBoq.closeout || summary?.closeout_record || {};
    const items = auditBoq.items || [];
    const totals = auditBoq.totals || {};

    const docNo = `AUD-${project.code || project.id || 'PRJ'}-${closeout.closeout_no || 'DRAFT'}`;
    const docTitle = 'تقرير الرقابة والتدقيق الداخلي لدورة حياة المواد وتباين التكاليف (Internal Audit BoQ)';
    const { headerHtml, footerHtml, todayDate } = this.getPrintBaseConfig(docTitle, docNo);

    this.setPageOrientation('landscape');
    const printArea = this.getOrCreatePrintArea();

    const curr = project.currency || 'ر.ي';

    const itemsRows = items.length === 0
      ? `<tr><td colspan="14" style="text-align: center; padding: 15px;">لا توجد بنود مسجلة</td></tr>`
      : items.map((it, idx) => `
        <tr>
          <td style="text-align: center; font-weight: 700;">${it.item_no || (idx + 1)}</td>
          <td style="font-weight: 600; color: #0f2744;">${it.description}</td>
          <td style="text-align: center;">${it.unit || '-'}</td>
          <td style="text-align: center;">${App.formatNumber(it.BaselineQuantity)}</td>
          <td style="text-align: center;">${App.formatNumber(it.PurchasedQuantity)}</td>
          <td style="text-align: center;">${App.formatNumber(it.ReceivedQuantity)}</td>
          <td style="text-align: center;">${App.formatNumber(it.IssuedQuantity)}</td>
          <td style="text-align: center; font-weight: 700;">${App.formatNumber(it.ConsumedQuantity)}</td>
          <td style="text-align: center; font-weight: 700; color: #2980b9;">${App.formatNumber(it.SiteStockBalance)}</td>
          <td style="text-align: center;">${App.formatNumber(it.RemainingBaseline)}</td>
          <td style="text-align: center; color: #c0392b;">${App.formatNumber(it.wastage_quantity)}</td>
          <td style="text-align: right;">${App.formatNumber(it.actual_cost)}</td>
          <td style="text-align: right; color: ${it.cost_variance >= 0 ? '#15803d' : '#c0392b'};">${App.formatNumber(it.cost_variance)}</td>
          <td style="text-align: right; font-weight: 700; color: ${it.gross_profit >= 0 ? '#15803d' : '#c0392b'};">${App.formatNumber(it.gross_profit)} (${it.margin_pct}%)</td>
        </tr>
      `).join('');

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-compact margins-narrow" style="width: 100%; max-width: 297mm; margin: 0 auto; background: #fff; box-shadow: none;">
        ${headerHtml}

        <div class="report-content-body">
          <!-- بيانات المشروع -->
          <table class="official-report-table" style="margin-bottom: 10px; font-size: 0.8rem;">
            <tr>
              <td style="font-weight: 800; width: 14%; background: #f1f5f9;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744; width: 36%;">${project.name || '-'} (${project.code || ''})</td>
              <td style="font-weight: 800; width: 14%; background: #f1f5f9;">الجهة المالكة:</td>
              <td style="width: 36%;">${project.client_name || 'غير محدد'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">حالة الإغلاق:</td>
              <td><strong>${closeout.status === 'closed' ? '🔒 إغلاق نهائي معتمد ومثبت' : '🟢 قيد التدقيق والمعاينة المباشرة'}</strong></td>
              <td style="font-weight: 800; background: #f1f5f9;">البصمة الرقمية HMAC:</td>
              <td style="font-family: monospace; font-size: 0.72rem; color: #64748b;">${closeout.verification_hash ? closeout.verification_hash.substring(0, 32) + '...' : 'تولد آلياً عند الإغلاق'}</td>
            </tr>
          </table>

          <!-- مؤشرات التدقيق والتحليلات المالية -->
          <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; font-size: 0.78rem;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px; text-align: center; background: #f8fafc;">
              <div style="color: #64748b; font-size: 0.68rem;">قيمة العقد</div>
              <div style="font-weight: 800; color: #0f2744;">${App.formatNumber(totals.baseline_value)} ${curr}</div>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px; text-align: center; background: #f8fafc;">
              <div style="color: #64748b; font-size: 0.68rem;">إجمالي الإيراد المنفذ</div>
              <div style="font-weight: 800; color: #0f2744;">${App.formatNumber(totals.total_billed_amount)} ${curr}</div>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px; text-align: center; background: #f8fafc;">
              <div style="color: #64748b; font-size: 0.68rem;">التكلفة الفعلية</div>
              <div style="font-weight: 800; color: #b91c1c;">${App.formatNumber(totals.total_actual_cost)} ${curr}</div>
            </div>
            <div style="border: 1px solid #86efac; border-radius: 4px; padding: 5px; text-align: center; background: #f0fdf4;">
              <div style="color: #15803d; font-size: 0.68rem;">مجمل الربح (%الهامش)</div>
              <div style="font-weight: 800; color: #15803d;">${App.formatNumber(totals.gross_profit)} (${totals.profit_margin_pct}%)</div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 4px; padding: 5px; text-align: center; background: #fef2f2;">
              <div style="color: #b91c1c; font-size: 0.68rem;">تكلفة الهدر والفاقد</div>
              <div style="font-weight: 800; color: #b91c1c;">${App.formatNumber(totals.total_wastage_cost)} ${curr}</div>
            </div>
            <div style="border: 1px solid #93c5fd; border-radius: 4px; padding: 5px; text-align: center; background: #eff6ff;">
              <div style="color: #1d4ed8; font-size: 0.68rem;">رصيد مواد الموقع (فائض)</div>
              <div style="font-weight: 800; color: #1d4ed8;">${App.formatNumber(totals.total_site_stock_cost)} ${curr}</div>
            </div>
          </div>

          <!-- جدول الحقول السبعة لدورة حياة المواد -->
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 10px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th rowspan="2" style="width: 4%;">بند</th>
                <th rowspan="2" style="width: 18%;">بيان الأعمال والمواد</th>
                <th rowspan="2" style="width: 5%;">الوحدة</th>
                <th colspan="7" style="background: #e2e8f0; color: #0f2744; text-align: center;">دورة حياة المواد الميدانية (الحقول السبعة الدقيقة)</th>
                <th rowspan="2" style="width: 6%;">الهدر</th>
                <th rowspan="2" style="width: 9%;">التكلفة الفعلية</th>
                <th rowspan="2" style="width: 8%;">تباين التكلفة</th>
                <th rowspan="2" style="width: 10%;">مجمل الربح (الهامش)</th>
              </tr>
              <tr style="background: #f8fafc; font-size: 0.68rem;">
                <th title="المخصص الأولي المقدر">1.المقدرة</th>
                <th title="الإجمالي المشتري">2.المشتراة</th>
                <th title="المستلمة فعلياً">3.المستلمة</th>
                <th title="المصروفة للموقع">4.المصروفة</th>
                <th title="المستهلكة في التنفيذ">5.المستهلكة</th>
                <th title="رصيد الموقع المتبقي = Issued - Consumed" style="color: #2980b9;">6.رصيد الموقع</th>
                <th title="متبقي المقدر = Baseline - Consumed">7.متبقي المقدر</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
            <tfoot>
              <tr style="background: #f8fafc; font-weight: 800;">
                <td colspan="11" style="text-align: left;">الإجماليات العامة:</td>
                <td style="text-align: right; color: #b91c1c;">${App.formatNumber(totals.total_actual_cost)}</td>
                <td style="text-align: right; color: ${totals.total_cost_variance >= 0 ? '#15803d' : '#b91c1c'};">${App.formatNumber(totals.total_cost_variance)}</td>
                <td style="text-align: right; color: #15803d;">${App.formatNumber(totals.gross_profit)} (${totals.profit_margin_pct}%)</td>
              </tr>
            </tfoot>
          </table>

          <!-- توقيعات لجنة الرقابة والتدقيق -->
          <div class="letterhead-signatures-row" style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #cbd5e1;">
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.78rem; color: #0f2744; margin-bottom: 30px;">مدقق المواد والمستودعات</div>
              <div style="font-size: 0.75rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">التوقيع: .....................</div>
            </div>
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.78rem; color: #0f2744; margin-bottom: 30px;">مهندس تكاليف المشاريع</div>
              <div style="font-size: 0.75rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">التوقيع: .....................</div>
            </div>
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.78rem; color: #0f2744; margin-bottom: 30px;">مدير الرقابة والتدقيق الداخلي</div>
              <div style="font-size: 0.75rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">المصادقة: .....................</div>
            </div>
            <div style="text-align: center; width: 23%;">
              <div style="font-weight: 700; font-size: 0.78rem; color: #0f2744; margin-bottom: 30px;">المدير المالي التنفيذي</div>
              <div style="font-size: 0.75rem; border-top: 1px dashed #94a3b8; padding-top: 4px;">الاعتماد: .....................</div>
            </div>
          </div>
        </div>

        ${footerHtml}
      </div>
    `;

    printArea.style.display = 'block';
    setTimeout(() => {
      window.print();
    }, 150);
  }
};

if (typeof window !== 'undefined') {
  window.ProjectCloseout = ProjectCloseout;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProjectCloseout;
}
