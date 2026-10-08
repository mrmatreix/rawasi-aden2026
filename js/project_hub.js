/**
 * مساحة عمل إدارة المشاريع الهندسية والمقاولات (14 متطلب شامل) - شركة رواسي عدن
 */

const ProjectHub = {
  currentProjectId: null,
  activeTab: 'contract',
  data: null,

  async init() {
    console.log('🏗️ تهيئة مساحة عمل المشروع الشاملة (Project Hub)...');
    await this.populateProjectSelect();
  },

  calcQuotationTotal() {
    const sub = Number(document.getElementById('quoModalSubtotal')?.value || 0);
    const disc = Number(document.getElementById('quoModalDiscount')?.value || 0);
    const totalEl = document.getElementById('quoModalTotal');
    if (totalEl) totalEl.value = Math.max(0, sub - disc);
  },

  calcPurchaseTotal() {
    const qty = Number(document.getElementById('projPurQty')?.value || 1);
    const price = Number(document.getElementById('projPurPrice')?.value || 0);
    const totalEl = document.getElementById('projPurTotal');
    if (totalEl) totalEl.value = qty * price;
  },

  calcLaborTotal() {
    const count = Number(document.getElementById('projLaborCount')?.value || 1);
    const rate = Number(document.getElementById('projLaborRate')?.value || 0);
    const days = Number(document.getElementById('projLaborDays')?.value || 1);
    const totalEl = document.getElementById('projLaborTotal');
    if (totalEl) totalEl.value = count * rate * days;
  },

  calcIpcNet() {
    const cum = Number(document.getElementById('ipcModalCumWork')?.value || 0);
    const prev = Number(document.getElementById('ipcModalPrevBills')?.value || 0);
    const gross = Math.max(0, cum - prev);
    const grossEl = document.getElementById('ipcModalGross');
    if (grossEl) grossEl.value = gross;
    const adv = Number(document.getElementById('ipcModalAdvDed')?.value || 0);
    const ret = Number(document.getElementById('ipcModalRetDed')?.value || 0);
    const oth = Number(document.getElementById('ipcModalOtherDed')?.value || 0);
    const netEl = document.getElementById('ipcModalNet');
    if (netEl) netEl.value = Math.max(0, gross - adv - ret - oth);
  },

  calcSettlementDue() {
    const exec = Number(document.getElementById('settleModalExec')?.value || 0);
    const paid = Number(document.getElementById('settleModalPaid')?.value || 0);
    const ret = Number(document.getElementById('settleModalRet')?.value || 0);
    const pen = Number(document.getElementById('settleModalPenalties')?.value || 0);
    const dueEl = document.getElementById('settleModalDue');
    if (dueEl) dueEl.value = Math.max(0, exec - paid + ret - pen);
  },

  getActiveProjectId() {
    let pid = Number(this.currentProjectId);
    if (!pid || isNaN(pid) || pid <= 0) {
      const select = document.getElementById('hubProjectSelect');
      const selectVal = select?.value;
      if (selectVal && !isNaN(Number(selectVal)) && Number(selectVal) > 0) {
        pid = Number(selectVal);
      } else if (this.data?.project?.id) {
        pid = Number(this.data.project.id);
      } else if (window.Projects && Projects.list && Projects.list.length > 0 && Projects.list[0].id) {
        pid = Number(Projects.list[0].id);
      }
    }
    if (pid && !isNaN(pid) && pid > 0) {
      this.currentProjectId = pid;
      const select = document.getElementById('hubProjectSelect');
      if (select && select.value != String(pid)) {
        select.value = pid;
      }
      return pid;
    }
    return null;
  },

  async populateProjectSelect() {
    const select = document.getElementById('hubProjectSelect');
    if (!select) return;

    try {
      const res = await fetch('/api/projects');
      const json = await res.json().catch(() => ({ success: false, message: `تعذر استلام رد من الخادم (رمز ${res.status})` }));
      if (json.success && json.data && json.data.length > 0) {
        if (!this.currentProjectId || !json.data.some(p => p.id == this.currentProjectId)) {
          this.currentProjectId = json.data[0].id;
        }

        select.innerHTML = json.data.map(p => `
          <option value="${p.id}" ${this.currentProjectId == p.id ? 'selected' : ''}>
            ${p.code || 'PRJ'} - ${p.name} (${p.client_name || 'عميل مباشر'})
          </option>
        `).join('');

        select.value = this.currentProjectId;
      } else {
        select.innerHTML = `<option value="">لا توجد مشاريع مسجلة</option>`;
      }
    } catch (e) {
      console.error('Error populating project select:', e);
    }
  },

  async openProject(projectId, tab = 'contract') {
    this.currentProjectId = Number(projectId);
    this.activeTab = tab;
    this.selectedQuotationNo = null;
    this.integratedQuotationData = null;

    // التنقل إلى شاشة مساحة عمل المشروع
    App.navigate('projectHub');

    // تحديث القائمة المنسدلة
    const select = document.getElementById('hubProjectSelect');
    if (select) select.value = this.currentProjectId;

    await this.loadProjectData();
  },

  async onProjectSelectChange(e) {
    const newId = e.target.value;
    if (newId) {
      this.currentProjectId = Number(newId);
      this.selectedQuotationNo = null;
      this.integratedQuotationData = null;
      await this.loadProjectData();
    }
  },

  async loadProjectData() {
    if (!this.currentProjectId) return;

    try {
      App.showToast('جاري تحميل بيانات ومستندات المشروع...', 'info');
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/overview`);
      const json = await res.json().catch(() => ({ success: false, message: `تعذر استلام رد من الخادم (رمز ${res.status})` }));

      if (json.success && json.data) {
        this.data = json.data;
        this.renderHeaderAndKPIs();
        this.updateTabCounters();
        this.switchTab(this.activeTab);
        // تأكيد وإنشاء مجلد المشروع الفعلي على القرص فور فتح المشروع وجلب مساره
        await this.syncProjectFolder();
      } else {
        App.showToast(json.message || 'تعذر جلب تفاصيل المشروع', 'error');
      }
    } catch (e) {
      console.error('Error loading project hub data:', e);
      App.showToast('فشل في الاتصال بالخادم لجلب بيانات مساحة العمل', 'error');
    }
  },

  renderHeaderAndKPIs() {
    if (!this.data) return;
    const { project, stats } = this.data;
    const curr = project.currency || 'ر.ي';

    // الرأس العلوي
    const titleEl = document.getElementById('hubProjectTitle');
    const codeEl = document.getElementById('hubProjectCode');
    const clientEl = document.getElementById('hubProjectClient');
    const statusBadgeEl = document.getElementById('hubProjectStatusBadge');

    if (titleEl) titleEl.innerText = project.name;
    if (codeEl) codeEl.innerText = project.code || 'PRJ';
    if (clientEl) clientEl.innerText = `العميل / المالك: ${project.client_name || 'عميل مباشر'} | الهاتف: ${project.client_phone || 'غير مسجل'}`;
    
    if (statusBadgeEl) {
      const isComp = project.status === 'completed';
      statusBadgeEl.className = `drawing-badge-status ${isComp ? 'approved' : 'pending'}`;
      statusBadgeEl.innerText = isComp ? 'مكتمل ومسلّم ✅' : 'قيد التنفيذ ⚙️';
    }

    // شريط الـ KPIs
    const kpiContract = document.getElementById('hubKpiContractVal');
    const kpiChangeOrders = document.getElementById('hubKpiChangeOrders');
    const kpiRevisedVal = document.getElementById('hubKpiRevisedVal');
    const kpiActualCost = document.getElementById('hubKpiActualCost');
    const kpiInvoicesNet = document.getElementById('hubKpiInvoicesNet');
    const kpiProgress = document.getElementById('hubKpiProgress');

    if (kpiContract) kpiContract.innerHTML = `${App.formatNumber(stats.originalContractValue)} <small>${curr}</small>`;
    if (kpiChangeOrders) kpiChangeOrders.innerHTML = `${stats.totalApprovedChangeOrders >= 0 ? '+' : ''}${App.formatNumber(stats.totalApprovedChangeOrders)} <small>${curr}</small>`;
    if (kpiRevisedVal) kpiRevisedVal.innerHTML = `${App.formatNumber(stats.revisedContractValue)} <small>${curr}</small>`;
    if (kpiActualCost) kpiActualCost.innerHTML = `${App.formatNumber(project.actual_cost || (stats.totalPurchasesAmount + stats.totalLaborAmount))} <small>${curr}</small>`;
    if (kpiInvoicesNet) kpiInvoicesNet.innerHTML = `${App.formatNumber(stats.totalInvoicesNet)} <small>${curr}</small>`;
    if (kpiProgress) kpiProgress.innerHTML = `${project.progress_percentage || 0}%`;
  },

  updateTabCounters() {
    if (!this.data) return;
    const { drawings, boq, quotations, changeOrders, purchases, labor, invoices, dailyReports, weeklyReports, handovers, correspondence, settlement } = this.data;

    this.setCountBadge('cnt_drawings', drawings?.length || 0);
    this.setCountBadge('cnt_boq', boq?.length || 0);
    this.setCountBadge('cnt_quotations', quotations?.length || 0);
    this.setCountBadge('cnt_change_orders', changeOrders?.length || 0);
    this.setCountBadge('cnt_purchases', purchases?.length || 0);
    this.setCountBadge('cnt_labor', labor?.length || 0);
    this.setCountBadge('cnt_invoices', invoices?.length || 0);
    this.setCountBadge('cnt_daily', dailyReports?.length || 0);
    this.setCountBadge('cnt_weekly', weeklyReports?.length || 0);
    this.setCountBadge('cnt_handovers', handovers?.length || 0);
    this.setCountBadge('cnt_correspondence', correspondence?.length || 0);
    this.setCountBadge('cnt_settlement', settlement ? '1' : '0');
    if (this.folderInfo && this.folderInfo.filesCount !== undefined) {
      this.setCountBadge('cnt_project_files', this.folderInfo.filesCount);
    }
    let quoCount = 0;
    if (this.integratedQuotationData && this.integratedQuotationData.items) {
      quoCount = this.integratedQuotationData.items.length;
    } else if (quotations && quotations.length > 0 && quotations[0].items_json) {
      try {
        const parsed = JSON.parse(quotations[0].items_json);
        quoCount = Array.isArray(parsed) ? parsed.length : (boq?.length || 1);
      } catch (e) {
        quoCount = boq?.length || 1;
      }
    } else {
      quoCount = boq?.length || 1;
    }
    this.setCountBadge('cnt_integrated_quotation', quoCount);
  },

  setCountBadge(elementId, count) {
    const el = document.getElementById(elementId);
    if (el) el.innerText = count;
  },

  switchTab(tabId) {
    this.activeTab = tabId;

    // تحديث أزرار التبويبات
    document.querySelectorAll('.hub-tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`hubTabBtn_${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    // إخفاء كافة لوحات المحتوى وإظهار اللوحة المحددة
    document.querySelectorAll('.hub-pane-view').forEach(p => p.style.display = 'none');
    const activePane = document.getElementById(`hubPane_${tabId}`);
    if (activePane) activePane.style.display = 'block';

    // ضمان توفر معرف المشروع المعتمد
    if (!this.currentProjectId) {
      const select = document.getElementById('hubProjectSelect');
      if (select && select.value) {
        this.currentProjectId = Number(select.value);
      } else if (window.Projects && Projects.list && Projects.list.length > 0 && Projects.list[0].id) {
        this.currentProjectId = Projects.list[0].id;
      }
    }

    // التبويبات المستقلة التي تجلب بياناتها ذاتياً
    if (tabId === 'integrated-quotation') {
      this.renderIntegratedQuotation();
      return;
    }
    if (tabId === 'project-files') {
      this.renderProjectFiles();
      return;
    }
    if (tabId === 'smart-completion') {
      ProjectControlUI.renderSmartCompletion(this.currentProjectId);
      return;
    }
    if (tabId === 'wbs-schedule') {
      ProjectControlUI.renderWBSSchedule(this.currentProjectId);
      return;
    }
    if (tabId === 'evm-control') {
      ProjectControlUI.renderEVM(this.currentProjectId);
      return;
    }
    if (tabId === 'risks-claims') {
      ProjectControlUI.renderRisksAndClaims(this.currentProjectId);
      return;
    }

    if (!this.data) return;

    // استدعاء دالة العرض المناسبة
    switch (tabId) {
      case 'contract': this.renderContract(); break;
      case 'drawings': this.renderDrawings(); break;
      case 'boq': this.renderBOQ(); break;
      case 'quotations': this.renderQuotations(); break;
      case 'budgets': this.renderBudgets(); break;
      case 'change-orders': this.renderChangeOrders(); break;
      case 'purchases': this.renderPurchases(); break;
      case 'labor': this.renderLabor(); break;
      case 'invoices': this.renderInvoices(); break;
      case 'daily-reports': this.renderDailyReports(); break;
      case 'weekly-reports': this.renderWeeklyReports(); break;
      case 'handovers': this.renderHandovers(); break;
      case 'correspondence': this.renderCorrespondence(); break;
      case 'settlement': this.renderSettlement(); break;
      case 'smart-completion': ProjectControlUI.renderSmartCompletion(this.currentProjectId); break;
      case 'wbs-schedule': ProjectControlUI.renderWBSSchedule(this.currentProjectId); break;
      case 'evm-control': ProjectControlUI.renderEVM(this.currentProjectId); break;
      case 'risks-claims': ProjectControlUI.renderRisksAndClaims(this.currentProjectId); break;
    }
  },

  // =========================================================================
  // 1. عقد المشروع (Project Contract)
  // =========================================================================
  renderContract() {
    const container = document.getElementById('hubContractContent');
    if (!container || !this.data) return;

    const { contract, project } = this.data;
    const curr = project.currency || 'ر.ي';

    if (!contract) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px dashed var(--border-light);">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">📑</div>
          <h4 style="color: #fff; margin-bottom: 8px;">لم يتم توثيق عقد رسمي لهذا المشروع بعد</h4>
          <p style="color: var(--text-secondary); font-size: 0.86rem; margin-bottom: 18px;">يمكنك إنشاء وتوثيق عقد المشروع وشروط السداد ونطاق العمل وطباعته رسمياً.</p>
          <button class="btn btn-primary" onclick="ProjectHub.openEditContractModal()">+ إنشاء وتوثيق عقد المشروع</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 18px; margin-bottom: 20px;">
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
            <div>
              <span style="font-size: 0.74rem; color: var(--gold-light); font-weight: 700;">رقم العقد: ${contract.contract_no || 'CNT'}</span>
              <h3 style="color: #fff; margin: 4px 0 0 0; font-size: 1.15rem;">${contract.title || 'عقد تنفيذ أعمال مقاولات'}</h3>
            </div>
            <span class="drawing-badge-status approved">${contract.status || 'ساري'}</span>
          </div>

          <table class="custom-table" style="margin-bottom: 16px;">
            <tbody>
              <tr>
                <td style="width: 25%; font-weight: 700; color: var(--text-secondary);">الطرف الأول (المالك):</td>
                <td style="font-weight: 800; color: #fff;">${contract.first_party || project.client_name || '-'}</td>
              </tr>
              <tr>
                <td style="font-weight: 700; color: var(--text-secondary);">الطرف الثاني (المقاول):</td>
                <td style="font-weight: 800; color: var(--gold-light);">${contract.second_party || 'شركة رواسي عدن للهندسة والمقاولات'}</td>
              </tr>
              <tr>
                <td style="font-weight: 700; color: var(--text-secondary);">تاريخ توقيع العقد:</td>
                <td>${contract.contract_date || '-'} | مدة التنفيذ: <strong>${contract.duration_days || '-'} يوماً</strong></td>
              </tr>
              <tr>
                <td style="font-weight: 700; color: var(--text-secondary);">تاريخ البدء والانتهاء:</td>
                <td>من: <strong>${contract.start_date || project.start_date || '-'}</strong> إلى: <strong>${contract.end_date || project.end_date || '-'}</strong></td>
              </tr>
            </tbody>
          </table>

          <div style="margin-bottom: 14px;">
            <h5 style="color: var(--gold-light); margin-bottom: 6px;">نطاق العمل ومسؤوليات المقاول:</h5>
            <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: var(--radius-sm); font-size: 0.86rem; line-height: 1.6; color: #e2e8f0;">
              ${contract.scope_of_work || 'لم يتم إدخال نطاق العمل التفصيلي.'}
            </div>
          </div>

          <div>
            <h5 style="color: var(--gold-light); margin-bottom: 6px;">شروط الدفع وصرف المستحقات:</h5>
            <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: var(--radius-sm); font-size: 0.86rem; line-height: 1.6; color: #e2e8f0;">
              ${contract.payment_terms || 'دفعات شهرية منتظمة وفق المستخلصات المعتمدة.'}
            </div>
          </div>
        </div>

        <!-- العمود المالي والشروط الجزائية -->
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="background: linear-gradient(135deg, rgba(212,175,55,0.12) 0%, rgba(14,28,50,0.6) 100%); border: 1px solid rgba(212,175,55,0.35); border-radius: var(--radius-md); padding: 16px;">
            <span style="font-size: 0.76rem; color: var(--gold-light);">القيمة الإجمالية للعقد</span>
            <h2 style="color: #fff; font-size: 1.45rem; margin: 4px 0 10px 0;">${App.formatNumber(contract.contract_value)} <small style="font-size:0.8rem; color:var(--gold-light)">${curr}</small></h2>
            
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.82rem; border-top: 1px dashed rgba(212,175,55,0.3); padding-top: 10px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">الدفعة المقدمة (${contract.advance_payment_pct || 0}%):</span>
                <strong>${App.formatNumber(contract.advance_payment_amount || (contract.contract_value * (contract.advance_payment_pct || 0) / 100))} ${curr}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">استقطاع ضمان الأعمال:</span>
                <strong>${contract.retention_pct || 10}% من كل مستخلص</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">غرامة التأخير اليومية:</span>
                <strong style="color: var(--accent-red);">${App.formatNumber(contract.penalty_per_day)} ${curr}/يوم</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">الحد الأقصى للغرامة:</span>
                <strong>${contract.max_penalty_pct || 10}% من قيمة العقد</strong>
              </div>
            </div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 14px;">
            <h5 style="color: #fff; margin-bottom: 8px;">ملاحظات إضافية:</h5>
            <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0; line-height: 1.5;">${contract.notes || 'لا توجد ملاحظات تعاقدية إضافية مسجلة.'}</p>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="ProjectHub.printOfficialContract()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
              <span>طباعة العقد الرسمي</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="ProjectHub.openEditContractModal()">تعديل العقد ✏️</button>
          </div>
        </div>
      </div>
    `;
  },

  openEditContractModal() {
    if (!this.data) return;
    const { contract, project } = this.data;

    document.getElementById('cntModalProjId').value = this.currentProjectId;
    document.getElementById('cntModalNo').value = contract ? (contract.contract_no || '') : `CNT-${new Date().getFullYear()}-${String(this.currentProjectId).padStart(3, '0')}`;
    document.getElementById('cntModalTitle').value = contract ? (contract.title || '') : `عقد تنفيذ ${project.name}`;
    document.getElementById('cntModalFirstParty').value = contract ? (contract.first_party || '') : (project.client_name || '');
    document.getElementById('cntModalSecondParty').value = contract ? (contract.second_party || '') : 'شركة رواسي عدن للهندسة والمقاولات';
    document.getElementById('cntModalDate').value = contract ? (contract.contract_date || '') : (project.start_date || new Date().toISOString().split('T')[0]);
    document.getElementById('cntModalStartDate').value = contract ? (contract.start_date || '') : (project.start_date || '');
    document.getElementById('cntModalEndDate').value = contract ? (contract.end_date || '') : (project.end_date || '');
    document.getElementById('cntModalDuration').value = contract ? (contract.duration_days || 365) : 365;
    document.getElementById('cntModalValue').value = contract ? contract.contract_value : project.contract_value;
    document.getElementById('cntModalCurrency').value = (contract && contract.currency) ? contract.currency : (project.currency || 'ر.ي');
    document.getElementById('cntModalAdvPct').value = contract ? (contract.advance_payment_pct || 10) : 10;
    document.getElementById('cntModalAdvAmount').value = contract ? (contract.advance_payment_amount || 0) : ((project.contract_value || 0) * 0.1);
    document.getElementById('cntModalRetentionPct').value = contract ? (contract.retention_pct || 10) : 10;
    document.getElementById('cntModalPenaltyDay').value = contract ? (contract.penalty_per_day || 0) : 0;
    document.getElementById('cntModalScope').value = contract ? (contract.scope_of_work || '') : '';
    document.getElementById('cntModalPaymentTerms').value = contract ? (contract.payment_terms || '') : 'دفعات شهرية منتظمة وفق المستخلصات المعتمدة.';
    document.getElementById('cntModalStatus').value = contract ? (contract.status || 'ساري') : 'ساري';
    document.getElementById('cntModalNotes').value = contract ? (contract.notes || '') : '';

    App.openModal('editContractModal');
  },

  async submitContractForm(e) {
    if (e) e.preventDefault();
    try {
      const payload = {
        contract_no: document.getElementById('cntModalNo').value,
        title: document.getElementById('cntModalTitle').value,
        first_party: document.getElementById('cntModalFirstParty').value,
        second_party: document.getElementById('cntModalSecondParty').value,
        contract_date: document.getElementById('cntModalDate').value,
        start_date: document.getElementById('cntModalStartDate').value,
        end_date: document.getElementById('cntModalEndDate').value,
        duration_days: document.getElementById('cntModalDuration').value,
        contract_value: document.getElementById('cntModalValue').value,
        currency: document.getElementById('cntModalCurrency').value,
        advance_payment_pct: document.getElementById('cntModalAdvPct').value,
        advance_payment_amount: document.getElementById('cntModalAdvAmount').value,
        retention_pct: document.getElementById('cntModalRetentionPct').value,
        penalty_per_day: document.getElementById('cntModalPenaltyDay').value,
        scope_of_work: document.getElementById('cntModalScope').value,
        payment_terms: document.getElementById('cntModalPaymentTerms').value,
        status: document.getElementById('cntModalStatus').value,
        notes: document.getElementById('cntModalNotes').value
      };

      const res = await fetch(`/api/project-hub/${this.currentProjectId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.success) {
        App.showToast('تم حفظ وتوثيق عقد المشروع بنجاح', 'success');
        App.closeModal('editContractModal');
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'فشل في حفظ العقد', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في الاتصال بالخادم أثناء حفظ العقد', 'error');
    }
  },

  // =========================================================================
  // 2. المخططات الهندسية (Engineering Drawings)
  // =========================================================================
  renderDrawings() {
    const tbody = document.getElementById('hubDrawingsTableBody');
    if (!tbody || !this.data) return;

    const drawings = this.data.drawings || [];
    if (drawings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مخططات هندسية مسجلة لهذا المشروع بعد.</td></tr>`;
      return;
    }

    tbody.innerHTML = drawings.map(d => {
      let statusClass = 'approved';
      if (d.status === 'معتمد بملاحظات') statusClass = 'with-notes';
      else if (d.status === 'قيد المراجعة') statusClass = 'pending';
      else if (d.status === 'مرفوض') statusClass = 'rejected';

      return `
        <tr>
          <td><strong>${d.drawing_no}</strong></td>
          <td>
            <strong>${d.title}</strong>
            ${d.file_name ? `<div style="font-size: 0.72rem; color: var(--accent-blue);">📁 ${d.file_name}</div>` : ''}
          </td>
          <td><span class="badge badge-income" style="background: rgba(56,189,248,0.15); color: var(--accent-blue);">${d.category}</span></td>
          <td>${d.scale || '1:100'} | <strong style="color:var(--gold-light)">${d.revision || 'Rev 0'}</strong></td>
          <td>
            <div>تقديم: ${d.submission_date || '-'}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">اعتماد: ${d.approval_date || '-'}</div>
          </td>
          <td><span class="drawing-badge-status ${statusClass}">${d.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.editDrawing(${d.id})" title="تعديل">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteDrawing(${d.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewDrawingModal() {
    document.getElementById('dwgModalForm').reset();
    document.getElementById('dwgModalId').value = '';
    document.getElementById('dwgModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('drawingModal');
  },

  editDrawing(id) {
    const d = (this.data.drawings || []).find(item => item.id == id);
    if (!d) return;

    document.getElementById('dwgModalId').value = d.id;
    document.getElementById('dwgModalNo').value = d.drawing_no;
    document.getElementById('dwgModalTitle').value = d.title;
    document.getElementById('dwgModalCategory').value = d.category;
    document.getElementById('dwgModalScale').value = d.scale || '1:100';
    document.getElementById('dwgModalRevision').value = d.revision || 'Rev 0';
    document.getElementById('dwgModalDate').value = d.submission_date || '';
    document.getElementById('dwgModalAppDate').value = d.approval_date || '';
    document.getElementById('dwgModalStatus').value = d.status || 'معتمد';
    document.getElementById('dwgModalEngineer').value = d.engineer_name || '';
    document.getElementById('dwgModalFileName').value = d.file_name || '';
    document.getElementById('dwgModalNotes').value = d.notes || '';

    App.openModal('drawingModal');
  },

  async submitDrawingForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('dwgModalId').value;
    const payload = {
      drawing_no: document.getElementById('dwgModalNo').value,
      title: document.getElementById('dwgModalTitle').value,
      category: document.getElementById('dwgModalCategory').value,
      scale: document.getElementById('dwgModalScale').value,
      revision: document.getElementById('dwgModalRevision').value,
      submission_date: document.getElementById('dwgModalDate').value,
      approval_date: document.getElementById('dwgModalAppDate').value,
      status: document.getElementById('dwgModalStatus').value,
      engineer_name: document.getElementById('dwgModalEngineer').value,
      file_name: document.getElementById('dwgModalFileName').value,
      notes: document.getElementById('dwgModalNotes').value
    };

    const url = id 
      ? `/api/project-hub/${this.currentProjectId}/drawings/${id}`
      : `/api/project-hub/${this.currentProjectId}/drawings`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ المخطط الهندسي بنجاح', 'success');
      App.closeModal('drawingModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المخطط', 'error');
    }
  },

  async deleteDrawing(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المخطط؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/drawings/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف المخطط', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 3. جدول الكميات BOQ (Bill of Quantities - Smart Engine & Excel Sync)
  // =========================================================================
  boqParsedItems: [],
  boqCurrentWorkbook: null,

  renderBOQ() {
    if (!this.data) return;
    const boq = this.data.boq || [];
    const curr = this.data.project.currency || 'ر.ي';

    // 1. حساب إحصائيات ومؤشرات الأداء (KPIs)
    let totalContractVal = 0;
    let totalExecutedVal = 0;
    let overbilledCount = 0;
    const categoriesSet = new Set();

    boq.forEach(b => {
      const cQty = Number(b.contract_qty) || 0;
      const eQty = Number(b.executed_qty) || 0;
      const rate = Number(b.unit_rate) || 0;
      const cTotal = Number(b.total_amount) || (cQty * rate);
      const eTotal = eQty * rate;

      totalContractVal += cTotal;
      totalExecutedVal += eTotal;
      if (eQty > cQty && cQty > 0) overbilledCount++;
      if (b.category) categoriesSet.add(b.category);
    });

    const progressPct = totalContractVal > 0 ? Math.min(100, Math.round((totalExecutedVal / totalContractVal) * 100)) : 0;

    // تحديث بطاقات الـ KPIs العلوية
    const kpiContract = document.getElementById('boqKpiContractVal');
    const kpiExecuted = document.getElementById('boqKpiExecutedVal');
    const kpiPct = document.getElementById('boqKpiProgressPct');
    const kpiBar = document.getElementById('boqKpiProgressBar');
    const kpiCount = document.getElementById('boqKpiItemsCount');
    const kpiOverbilled = document.getElementById('boqKpiOverbilledBadge');

    if (kpiContract) kpiContract.innerHTML = `${App.formatNumber(totalContractVal)} <small style="font-size:0.75rem;">${curr}</small>`;
    if (kpiExecuted) kpiExecuted.innerHTML = `${App.formatNumber(totalExecutedVal)} <small style="font-size:0.75rem;">${curr}</small>`;
    if (kpiPct) kpiPct.innerText = `${progressPct}%`;
    if (kpiBar) kpiBar.style.width = `${progressPct}%`;
    if (kpiCount) kpiCount.innerText = `${boq.length} بند`;

    if (kpiOverbilled) {
      if (overbilledCount > 0) {
        kpiOverbilled.style.display = 'inline-block';
        kpiOverbilled.innerText = `⚠️ ${overbilledCount} تجاوز كمية`;
      } else {
        kpiOverbilled.style.display = 'none';
      }
    }

    // تعبئة قائمة فلتر التصنيفات (WBS)
    const catFilter = document.getElementById('boqCategoryFilter');
    if (catFilter) {
      const currentSelected = catFilter.value;
      let optionsHtml = '<option value="">جميع التصنيفات الإنشائية (WBS)</option>';
      Array.from(categoriesSet).sort().forEach(cat => {
        optionsHtml += `<option value="${cat}" ${currentSelected === cat ? 'selected' : ''}>${cat}</option>`;
      });
      catFilter.innerHTML = optionsHtml;
    }

    // عرض الجدول المصفى
    this.filterBoqTable();
  },

  filterBoqTable() {
    const tbody = document.getElementById('hubBoqTableBody');
    if (!tbody || !this.data) return;

    const boq = this.data.boq || [];
    const curr = this.data.project.currency || 'ر.ي';

    const search = (document.getElementById('boqSearchInput')?.value || '').trim().toLowerCase();
    const cat = document.getElementById('boqCategoryFilter')?.value || '';
    const status = document.getElementById('boqStatusFilter')?.value || '';

    const filtered = boq.filter(b => {
      if (cat && b.category !== cat) return false;
      if (status) {
        if (status === 'overbilled') {
          if (!((Number(b.executed_qty) || 0) > (Number(b.contract_qty) || 0) && (Number(b.contract_qty) || 0) > 0)) return false;
        } else if (b.status !== status) {
          return false;
        }
      }
      if (search) {
        const itemNoMatch = String(b.item_no || '').toLowerCase().includes(search);
        const descMatch = String(b.description || '').toLowerCase().includes(search);
        const catMatch = String(b.category || '').toLowerCase().includes(search);
        const notesMatch = String(b.notes || '').toLowerCase().includes(search);
        if (!itemNoMatch && !descMatch && !catMatch && !notesMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 35px; color: var(--text-secondary);">لا توجد بنود مطابقة لمعايير البحث في جدول الكميات.</td></tr>`;
      return;
    }

    let subtotalContract = 0;
    let subtotalExecuted = 0;

    tbody.innerHTML = filtered.map(b => {
      const cQty = Number(b.contract_qty) || 0;
      const eQty = Number(b.executed_qty) || 0;
      const rate = Number(b.unit_rate) || 0;
      const cTotal = Number(b.total_amount) || (cQty * rate);
      const eTotal = eQty * rate;
      const remQty = Math.max(0, cQty - eQty);
      const isOverbilled = eQty > cQty && cQty > 0;
      const overbilledQty = isOverbilled ? (eQty - cQty) : 0;
      const progress = cQty > 0 ? Math.min(100, Math.round((eQty / cQty) * 100)) : (eQty > 0 ? 100 : 0);

      subtotalContract += cTotal;
      subtotalExecuted += eTotal;

      let remainingHtml = `<span>${App.formatNumber(remQty)}</span>`;
      if (isOverbilled) {
        remainingHtml = `<span class="badge" style="background: rgba(239,68,68,0.15); color: var(--accent-red); font-weight: 800;" title="تجاوز للكمية التعاقدية المعتمدة بمقدار ${overbilledQty}">+${App.formatNumber(overbilledQty)} ⚠️</span>`;
      }

      return `
        <tr style="${isOverbilled ? 'background: rgba(239,68,68,0.03);' : ''}">
          <td><strong style="color: var(--gold-light);">${b.item_no}</strong></td>
          <td>
            <div style="font-weight: 700; color: #fff;">${b.description}</div>
            ${b.notes ? `<div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">📝 ${b.notes}</div>` : ''}
          </td>
          <td><span class="badge" style="background: rgba(255,255,255,0.05); color: #cbd5e1; font-size: 0.72rem;">${b.category || 'عام'}</span></td>
          <td style="text-align: center;"><strong>${b.unit}</strong></td>
          <td><strong>${App.formatNumber(cQty)}</strong></td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <strong style="color: var(--accent-green);">${App.formatNumber(eQty)}</strong>
              <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.7rem; border-radius: 4px;" onclick="ProjectHub.openQuickProgressModal(${b.id})" title="تحديث كمية الإنجاز المنفذة بالموقع">⚡</button>
            </div>
          </td>
          <td>${remainingHtml}</td>
          <td>${App.formatNumber(rate)} <small>${curr}</small></td>
          <td style="color: var(--gold-light); font-weight: 800;">${App.formatNumber(cTotal)} <small>${curr}</small></td>
          <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(eTotal)} <small>${curr}</small></td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <div class="progress-wrap" style="flex: 1; height: 6px;">
                <div class="progress-bar-fill" style="width: ${progress}%; background: ${isOverbilled ? 'var(--accent-red)' : ''};"></div>
              </div>
              <span style="font-size: 0.72rem; font-weight: 700; ${isOverbilled ? 'color: var(--accent-red);' : ''}">${progress}%</span>
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.editBoqItem(${b.id})" title="تعديل مواصفات البند">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteBoqItem(${b.id})" title="حذف البند">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td colspan="4" style="text-align: right; color: var(--gold-light);">المجموع الإجمالي للبنود المعروضة:</td>
        <td colspan="4"></td>
        <td style="color: var(--gold-light); font-size: 1.05rem;">${App.formatNumber(subtotalContract)} ${curr}</td>
        <td style="color: var(--accent-green); font-size: 1.05rem;">${App.formatNumber(subtotalExecuted)} ${curr}</td>
        <td colspan="2"></td>
      </tr>
    `;
  },

  // =========================================================================
  // نوافذ التحديث السريع والإكسيل لجدول الكميات
  // =========================================================================
  openQuickProgressModal(id) {
    const b = (this.data?.boq || []).find(item => item.id == id);
    if (!b) return;

    document.getElementById('quickBoqItemId').value = b.id;
    document.getElementById('quickBoqItemNo').innerText = `بند رقم: ${b.item_no}`;
    document.getElementById('quickBoqItemUnit').innerText = `الوحدة: ${b.unit}`;
    document.getElementById('quickBoqItemDesc').innerText = b.description;
    document.getElementById('quickBoqContractQty').value = `${App.formatNumber(b.contract_qty)} ${b.unit}`;
    document.getElementById('quickBoqUnitRate').value = `${App.formatNumber(b.unit_rate)} ${this.data.project.currency || 'ر.ي'}`;

    const executedInput = document.getElementById('quickBoqExecutedQty');
    executedInput.value = b.executed_qty || 0;
    this.onQuickProgressQtyChange();

    App.openModal('boqQuickProgressModal');
  },

  onQuickProgressQtyChange() {
    const id = document.getElementById('quickBoqItemId').value;
    const b = (this.data?.boq || []).find(item => item.id == id);
    const notice = document.getElementById('quickBoqOverbillingNotice');
    if (!b || !notice) return;

    const val = Number(document.getElementById('quickBoqExecutedQty').value) || 0;
    const contractVal = Number(b.contract_qty) || 0;

    if (val > contractVal && contractVal > 0) {
      notice.style.display = 'block';
    } else {
      notice.style.display = 'none';
    }
  },

  async submitQuickProgress(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('quickBoqItemId').value;
    const executedQty = document.getElementById('quickBoqExecutedQty').value;

    try {
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/boq/quick-progress/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executed_qty: executedQty })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم تحديث كمية الإنجاز المنفذة بالموقع بنجاح ⚡', 'success');
        App.closeModal('boqQuickProgressModal');
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'فشل في تحديث الإنجاز', 'error');
      }
    } catch (err) {
      App.showToast('حدث خطأ أثناء حفظ كمية الإنجاز', 'error');
    }
  },

  // =========================================================================
  // محرك استيراد وتصدير جداول الكميات عبر Excel
  // =========================================================================
  openBoqExcelImportModal() {
    const pid = this.getActiveProjectId();
    if (!pid) {
      App.showToast('يرجى اختيار مشروع معتمد أولاً قبل استيراد جدول الكميات', 'warning');
      const select = document.getElementById('hubProjectSelect');
      if (select) select.focus();
      return;
    }

    this.boqParsedItems = [];
    this.boqCurrentWorkbook = null;

    // تحديث شارة المشروع المستهدف في نافذة الاستيراد
    const targetBadge = document.getElementById('boqImportTargetProjectName');
    if (targetBadge) {
      const projectName = this.data?.project?.name || (document.getElementById('hubProjectSelect')?.selectedOptions?.[0]?.text) || `مشروع رقم #${pid}`;
      targetBadge.innerText = projectName;
    }

    const fileInput = document.getElementById('boqExcelFileInput');
    if (fileInput) fileInput.value = '';
    const infoBar = document.getElementById('boqFileInfoBar');
    if (infoBar) infoBar.style.display = 'none';
    const statsBar = document.getElementById('boqPreviewStatsBar');
    if (statsBar) statsBar.style.display = 'none';
    const previewContainer = document.getElementById('boqPreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
    const execBtn = document.getElementById('boqExecuteImportBtn');
    if (execBtn) execBtn.disabled = true;

    App.openModal('boqExcelImportModal');
  },

  handleBoqFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
      App.showToast('مكتبة معالجة Excel قيد التحميل، يرجى إعادة المحاولة', 'warning');
      return;
    }

    document.getElementById('boqSelectedFileName').innerText = file.name;
    document.getElementById('boqSelectedFileSize').innerText = `${(file.size / 1024).toFixed(1)} KB`;
    document.getElementById('boqFileInfoBar').style.display = 'flex';

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        this.boqCurrentWorkbook = workbook;

        // تعبئة قائمة أوراق العمل
        const sheetSelect = document.getElementById('boqSheetSelect');
        sheetSelect.innerHTML = workbook.SheetNames.map(name => `<option value="${name}">${name}</option>`).join('');

        this.onBoqSheetChange();
      } catch (err) {
        console.error('Error parsing excel workbook:', err);
        App.showToast('تعذر قراءة ملف Excel، تأكد من سلامة تنسيق الملف', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  onBoqSheetChange() {
    if (!this.boqCurrentWorkbook) return;
    const sheetName = document.getElementById('boqSheetSelect').value;
    const sheet = this.boqCurrentWorkbook.Sheets[sheetName];
    if (!sheet) return;

    this.parseBoqSheet(sheet);
  },

  parseBoqSheet(sheet) {
    // تحويل ورقة العمل إلى مصفوفة صفوف ثنائية
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rawData || rawData.length === 0) {
      App.showToast('ورقة العمل المحددة فارغة', 'warning');
      return;
    }

    // 1. اكتشاف سطر الترويسة (Header Row Detection)
    let headerRowIdx = -1;
    let colMap = { itemNo: -1, desc: -1, cat: -1, unit: -1, qty: -1, rate: -1, notes: -1 };

    for (let r = 0; r < Math.min(10, rawData.length); r++) {
      const row = rawData[r].map(cell => String(cell || '').trim().toLowerCase());
      row.forEach((col, idx) => {
        if (colMap.itemNo === -1 && (col.includes('رقم') || col.includes('كود') || col === 'م' || col.includes('item') || col.includes('code') || col === 'no')) colMap.itemNo = idx;
        if (colMap.desc === -1 && (col.includes('وصف') || col.includes('بيان') || col.includes('اسم') || col.includes('desc') || col.includes('name') || col.includes('works'))) colMap.desc = idx;
        if (colMap.cat === -1 && (col.includes('تصنيف') || col.includes('قسم') || col.includes('مرحلة') || col.includes('category') || col.includes('wbs'))) colMap.cat = idx;
        if (colMap.unit === -1 && (col.includes('وحدة') || col.includes('unit'))) colMap.unit = idx;
        if (colMap.qty === -1 && (col.includes('كمية') || col.includes('كميه') || col.includes('qty') || col.includes('quantity'))) colMap.qty = idx;
        if (colMap.rate === -1 && (col.includes('سعر') || col.includes('فئة') || col.includes('rate') || col.includes('price'))) colMap.rate = idx;
        if (colMap.notes === -1 && (col.includes('ملاحظ') || col.includes('notes') || col.includes('remarks'))) colMap.notes = idx;
      });

      // إذا وجدنا عمودين أساسيين على الأقل مثل البيان والكمية
      if (colMap.desc !== -1 && (colMap.qty !== -1 || colMap.itemNo !== -1)) {
        headerRowIdx = r;
        break;
      }
    }

    // إذا لم يتم اكتشاف الترويسة بالاسم، نعتمد الترتيب الافتراضي للأعمدة
    if (headerRowIdx === -1) {
      headerRowIdx = 0;
      colMap = { itemNo: 0, cat: 1, desc: 2, unit: 3, qty: 4, rate: 5, notes: 6 };
    }

    // 2. استخراج البنود ومعالجة البيانات
    const items = [];
    let autoCounter = 1;
    let totalEstVal = 0;

    for (let r = headerRowIdx + 1; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.length === 0) continue;

      const desc = colMap.desc !== -1 ? String(row[colMap.desc] || '').trim() : '';
      if (!desc || desc === 'المجموع' || desc === 'الإجمالي' || desc.includes('total')) continue;

      const itemNo = colMap.itemNo !== -1 && row[colMap.itemNo] !== '' ? String(row[colMap.itemNo]).trim() : `BOQ-${String(autoCounter).padStart(3, '0')}`;
      const cat = colMap.cat !== -1 && row[colMap.cat] ? String(row[colMap.cat]).trim() : 'أعمال عامة';
      const unit = colMap.unit !== -1 && row[colMap.unit] ? String(row[colMap.unit]).trim() : 'م3';
      
      const rawQty = colMap.qty !== -1 ? row[colMap.qty] : 0;
      const rawRate = colMap.rate !== -1 ? row[colMap.rate] : 0;
      const notes = colMap.notes !== -1 && row[colMap.notes] ? String(row[colMap.notes]).trim() : '';

      const qty = Math.max(0, Number(String(rawQty).replace(/[^\d.-]/g, '')) || 0);
      const rate = Math.max(0, Number(String(rawRate).replace(/[^\d.-]/g, '')) || 0);
      const total = qty * rate;

      totalEstVal += total;
      autoCounter++;

      items.push({
        item_no: itemNo,
        description: desc,
        category: cat,
        unit: unit,
        contract_qty: qty,
        unit_rate: rate,
        total_amount: total,
        notes: notes
      });
    }

    if (items.length === 0) {
      App.showToast('لم يتم العثور على بنود صالحة للاستيراد في ورقة العمل المحددة', 'warning');
      return;
    }

    this.boqParsedItems = items;

    // 3. تحديث واجهة المعاينة والإحصائيات
    const statsBar = document.getElementById('boqPreviewStatsBar');
    const container = document.getElementById('boqPreviewContainer');
    const tbody = document.getElementById('boqPreviewTableBody');
    const btnExecute = document.getElementById('boqExecuteImportBtn');

    statsBar.style.display = 'grid';
    container.style.display = 'block';
    btnExecute.disabled = false;

    document.getElementById('boqPreviewRowCount').innerText = `${items.length} بند`;
    document.getElementById('boqPreviewTotalVal').innerHTML = `${App.formatNumber(totalEstVal)} <small>${this.data?.project?.currency || 'ر.ي'}</small>`;

    tbody.innerHTML = items.slice(0, 100).map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong style="color: var(--gold-light);">${it.item_no}</strong></td>
        <td>${it.description}</td>
        <td><span class="badge" style="background: rgba(255,255,255,0.05); color: #cbd5e1;">${it.category}</span></td>
        <td>${it.unit}</td>
        <td><strong>${App.formatNumber(it.contract_qty)}</strong></td>
        <td>${App.formatNumber(it.unit_rate)}</td>
        <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(it.total_amount)}</td>
      </tr>
    `).join('') + (items.length > 100 ? `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">... والمزيد من البنود (${items.length - 100} بند إضافي)</td></tr>` : '');
  },

  async executeBoqImport() {
    if (!this.boqParsedItems || this.boqParsedItems.length === 0) {
      App.showToast('لا توجد بنود جاهزة للاستيراد', 'warning');
      return;
    }

    const pid = this.getActiveProjectId();
    if (!pid) {
      App.showToast('لم يتم العثور على مشروع معتمد لتسجيل جدول الكميات إليه', 'error');
      return;
    }

    const mode = document.querySelector('input[name="boqImportMode"]:checked')?.value || 'merge';
    const updateContract = document.getElementById('boqUpdateContractValueCheck')?.checked || false;

    if (mode === 'replace') {
      if (!confirm(`⚠️ تحذير مهم:\nاخترت الاستبدال الكامل. سيتم حذف جميع بنود جدول الكميات الحالية لهذا المشروع (${this.data?.boq?.length || 0} بند) وإحلال ${this.boqParsedItems.length} بند جديد مكانها.\n\nهل تريد المتابعة بالتأكيد؟`)) {
        return;
      }
    }

    const btn = document.getElementById('boqExecuteImportBtn');
    btn.disabled = true;
    btn.innerHTML = `<span>جاري الاستيراد والترحيل... ⏳</span>`;

    try {
      const res = await fetch(`/api/project-hub/${pid}/boq/batch-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: pid,
          items: this.boqParsedItems,
          mode: mode,
          updateContract: updateContract
        })
      });
      const json = await res.json();

      if (json.success) {
        App.showToast(`تم استيراد ${json.totalCount} بند بنجاح إلى جدول الكميات (قيمة: ${App.formatNumber(json.totalContractValue)} ${this.data?.project?.currency || 'ر.ي'}) 🎉`, 'success');
        App.closeModal('boqExcelImportModal');
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'فشل في استيراد جدول الكميات', 'error');
      }
    } catch (err) {
      console.error('Error importing BOQ batch:', err);
      App.showToast('حدث خطأ في الاتصال بالخادم أثناء استيراد البنود', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>🚀 بدء الاستيراد والترحيل لقاعدة البيانات</span>`;
    }
  },

  // 1. تنزيل نموذج وقالب Excel فارغ ومجهز لجدول الكميات
  downloadBoqSampleTemplate() {
    try {
      App.showToast('جاري إعداد وتنزيل قالب Excel النموذجي لجدول الكميات...', 'info');

      // الطريقة الأولى: التوليد المباشر في المتصفح عبر SheetJS لضمان الفورية وعدم الاعتماد على الشبكة
      if (typeof XLSX !== 'undefined') {
        const templateRows = [
          ['شركة رواسي عدن للهندسة والمقاولات'],
          ['قالب استيراد جدول الكميات والمواصفات التعاقدية (BOQ Import Template)'],
          ['توجيهات: يرجى عدم تعديل عناوين الأعمدة في السطر (4) لضمان القراءة والمطابقة الآلية عند الاستيراد'],
          ['رقم البند', 'التصنيف الإنشائي', 'بيان ووصف بند العمل والمواصفات', 'الوحدة', 'الكمية', 'فئة السعر الإفرادي', 'ملاحظات'],
          ['1.01', 'أعمال الحفريات والردم', 'حفر في تربة صخرية ومتوسطة لتأسيس القواعد والميدات حتى المنسوب المعتمد شاملاً نقل المخلفات لمقالب عمومية', 'م3', 450, 3500, 'يشمل النقل والتسوية والدمك'],
          ['1.02', 'أعمال الحفريات والردم', 'ردم حول القواعد والميدات برمل نظيف مورد على طبقات 25 سم مع الرش بالماء والدمك بنسبة 95%', 'م3', 280, 1800, 'اختبار بروكتور مطلوب'],
          ['2.01', 'أعمال خرسانية', 'خرسانة عادية نظافة أسفل القواعد سمك 10 سم مقاومة 200 كجم/سم2 مع المواد والمعدات والدمك', 'م3', 45, 18500, 'إسمنت مقاوم للكبريتات SRC'],
          ['2.02', 'أعمال خرسانية', 'خرسانة مسلحة للقواعد والرقاب مقاومة 350 كجم/سم2 مع المواد وحديد التسليح رتبة 60', 'م3', 120, 48000, 'حديد سابك معتمد'],
          ['2.03', 'أعمال خرسانية', 'خرسانة مسلحة للأعمدة والحوائط الخرسانية مقاومة 350 كجم/سم2 صب مضخة شاملاً الشدات الخشبية', 'م3', 65, 52000, 'صب بالمضخة وتثبيت كانات'],
          ['2.04', 'أعمال خرسانية', 'خرسانة مسلحة للأسقف والكمرات الهوردي مقاومة 350 كجم/سم2 شاملاً القوالب والبلوك الهوردي والحديد', 'م3', 160, 54000, 'معالجة بالمياه 7 أيام متتالية'],
          ['3.01', 'أعمال مباني وعزل', 'مباني طابوق أسمنتي مصمت للميدات سمك 20 سم بمونة إسمنتية 1:3', 'م2', 320, 2400, 'طابوق آلي عالي الكثافة'],
          ['3.02', 'أعمال مباني وعزل', 'مباني طابوق أسمنتي مفرغ للقواطع الداخلية والخارجية سمك 20 سم بمونة إسمنتية', 'م2', 850, 1950, 'ربط بشبك مجلفن كل مدماكين'],
          ['3.03', 'أعمال مباني وعزل', 'عزل مائي للقواعد ورقاب الأعمدة بطبقتين من البيتومين المطاطي على البارد', 'م2', 540, 650, 'دهان متعامد وجهين مع الأساس'],
          ['4.01', 'أعمال تشطيبات', 'بياض ولياسة إسمنتية داخلية للأسقف والحوائط مع الطرطشة والشبك المعدني والزوايا', 'م2', 1800, 1200, 'استواء تام ووزن قامة وفق الأصول'],
          ['4.02', 'أعمال تشطيبات', 'دهانات بلاستيكية داخلية 3 أوجه مقاومة للبكتيريا شاملاً المعجون والأساس والصنفرة', 'م2', 1800, 950, 'نوع جوتن أو ما يماثله'],
          ['5.01', 'أعمال كهروميكانيكية', 'توريد وتمديد مواسير PVC وأسلاك النحاس للإنارة والمخارج لكل نقطة كاملة مع العلب والمفاتيح', 'نقطة', 240, 3200, 'أسلاك الرياض أو كابلات بحرة'],
          ['5.02', 'أعمال كهروميكانيكية', 'تمديد خطوط الصرف الصحي ومواسير التغذية PPR الحرارية لكل حمام ومطبخ مع المحابس', 'مقطوع', 8, 45000, 'مواسير حرارية ألمانية معتمدة']
        ];

        const ws = XLSX.utils.aoa_to_sheet(templateRows);
        if (!ws['!views']) ws['!views'] = [];
        ws['!views'].push({ RTL: true });

        ws['!cols'] = [
          { wch: 14 }, // رقم البند
          { wch: 24 }, // التصنيف
          { wch: 60 }, // البيان والمواصفات
          { wch: 10 }, // الوحدة
          { wch: 14 }, // الكمية
          { wch: 18 }, // فئة السعر
          { wch: 30 }  // ملاحظات
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'قالب جدول كميات نموذجي');

        XLSX.writeFile(wb, 'قالب_جدول_الكميات_التعاقدي_رواسي_عدن_BOQ.xlsx');
        App.showToast('تم تنزيل قالب Excel النموذجي بنجاح 🎉', 'success');
        return;
      }

      // الطريقة الثانية: تنزيل آمن عبر fetch مع توكن المصادقة (Fallback)
      const pid = this.currentProjectId || Number(document.getElementById('hubProjectSelect')?.value) || 1;
      this.downloadBlobFile(`/api/project-hub/${pid}/boq/sample-template`, 'قالب_جدول_الكميات_التعاقدي_رواسي_عدن_BOQ.xlsx');
    } catch (e) {
      console.error('Error downloading BOQ template:', e);
      App.showToast('حدث خطأ أثناء تنزيل قالب Excel: ' + (e.message || ''), 'error');
    }
  },

  // 2. تصدير جدول الكميات الحالي إلى ملف Excel رسمي
  exportBoqToExcel() {
    try {
      if (!this.currentProjectId) {
        const select = document.getElementById('hubProjectSelect');
        if (select && select.value) {
          this.currentProjectId = Number(select.value);
        }
      }

      const projectName = this.data?.project?.name || document.getElementById('hubProjectSelect')?.selectedOptions?.[0]?.text?.trim() || 'مشروع_رواسي_عدن';
      const cleanProjectName = projectName.replace(/[\\/:*?"<>|]/g, '_');
      const boqItems = this.data?.boq || [];

      // إذا كانت القائمة فارغة
      if (!boqItems || boqItems.length === 0) {
        App.showToast('جدول الكميات لهذا المشروع فارغ حالياً (0 بند). جاري تنزيل قالب العمل لإدخال البنود...', 'warning');
        this.downloadBoqSampleTemplate();
        return;
      }

      App.showToast('جاري تصدير جدول الكميات إلى ملف Excel رسمي...', 'info');

      // الطريقة الأولى: التصدير المباشر والمفصل عبر SheetJS (XLSX)
      if (typeof XLSX !== 'undefined') {
        const dateStr = new Date().toISOString().split('T')[0];
        const currency = this.data?.project?.currency || 'ر.ي';

        const rows = [
          ['شركة رواسي عدن للهندسة والمقاولات'],
          [`جدول الكميات والمواصفات التعاقدية (BOQ) - مشروع: ${projectName}`],
          [`تاريخ التصدير: ${dateStr} | العملة: ${currency} | إجمالي البنود المسجلة: ${boqItems.length}`],
          [], // سطر فارغ
          [
            'م', 'رقم البند', 'التصنيف الإنشائي (WBS)', 'بيان الأعمال والمواصفات التعاقدية',
            'الوحدة', 'الكمية التعاقدية', 'الكمية المنفذة بالموقع', 'الكمية المتبقية',
            `فئة السعر (${currency})`, `الإجمالي التعاقدي (${currency})`, `القيمة المنفذة (${currency})`,
            'نسبة الإنجاز %', 'الحالة', 'ملاحظات'
          ]
        ];

        let totalContract = 0;
        let totalExecuted = 0;

        boqItems.forEach((b, idx) => {
          const cQty = Number(b.contract_qty) || 0;
          const eQty = Number(b.executed_qty) || 0;
          const rate = Number(b.unit_rate) || 0;
          const cTotal = Number(b.total_amount) || (cQty * rate);
          const eTotal = eQty * rate;
          const rem = Math.max(0, cQty - eQty);
          const pct = cQty > 0 ? Math.round((eQty / cQty) * 100) + '%' : '0%';

          totalContract += cTotal;
          totalExecuted += eTotal;

          rows.push([
            idx + 1,
            b.item_no || `${idx + 1}.01`,
            b.category || 'عام',
            b.description || '',
            b.unit || 'مقطوع',
            cQty,
            eQty,
            rem,
            rate,
            cTotal,
            eTotal,
            pct,
            b.status || 'جاري التنفيذ',
            b.notes || ''
          ]);
        });

        // سطر الإجماليات الختامي
        const totalPct = totalContract > 0 ? Math.round((totalExecuted / totalContract) * 100) + '%' : '0%';
        rows.push([
          'الإجمالي العام', '', '', 'إجمالي قيمة جدول الكميات التعاقدي والمنفذ',
          '', '', '', '', '',
          totalContract,
          totalExecuted,
          totalPct,
          '', ''
        ]);

        const ws = XLSX.utils.aoa_to_sheet(rows);
        if (!ws['!views']) ws['!views'] = [];
        ws['!views'].push({ RTL: true });

        ws['!cols'] = [
          { wch: 6 },  // م
          { wch: 14 }, // رقم البند
          { wch: 22 }, // التصنيف
          { wch: 55 }, // بيان الأعمال
          { wch: 10 }, // الوحدة
          { wch: 15 }, // الكمية التعاقدية
          { wch: 16 }, // المنفذ
          { wch: 15 }, // المتبقي
          { wch: 16 }, // فئة السعر
          { wch: 18 }, // الإجمالي التعاقدي
          { wch: 18 }, // القيمة المنفذة
          { wch: 14 }, // نسبة الإنجاز
          { wch: 14 }, // الحالة
          { wch: 25 }  // ملاحظات
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'جدول الكميات BOQ');

        const fileName = `BOQ_${cleanProjectName}_${dateStr}.xlsx`;
        XLSX.writeFile(wb, fileName);
        App.showToast(`تم تصدير ${boqItems.length} بند بنجاح إلى ملف Excel 📊`, 'success');
        return;
      }

      // الطريقة الثانية: التنزيل الاحتياطي من الخادم مع المصادقة (Fallback)
      const fileName = `BOQ_${cleanProjectName}.xlsx`;
      const pid = this.currentProjectId || 1;
      this.downloadBlobFile(`/api/project-hub/${pid}/boq/export-excel`, fileName);
    } catch (e) {
      console.error('Error exporting BOQ to Excel:', e);
      App.showToast('حدث خطأ أثناء تصدير جدول الكميات: ' + (e.message || ''), 'error');
    }
  },

  // أداة تنزيل الملفات الثنائية والتقارير بأمان مع توكن المصادقة (Authenticated Blob Downloader)
  async downloadBlobFile(url, filename) {
    try {
      const token = (window.Auth && window.Auth.token)
        || sessionStorage.getItem('rawasi_token')
        || localStorage.getItem('rawasi_token');

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || `خطأ استجابة من الخادم (${res.status})`);
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'download.xlsx';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 250);
      App.showToast('تم تنزيل الملف بنجاح 🎉', 'success');
    } catch (err) {
      console.error('Download blob error:', err);
      // تجربة الرابط المباشر مع بارامتر التوكن كحل احتياطي أخير
      const token = (window.Auth && window.Auth.token)
        || sessionStorage.getItem('rawasi_token')
        || localStorage.getItem('rawasi_token');
      if (token) {
        const sep = url.includes('?') ? '&' : '?';
        window.open(`${url}${sep}token=${encodeURIComponent(token)}`, '_blank');
      } else {
        App.showToast(err.message || 'تعذر تنزيل الملف، يرجى تسجيل الدخول', 'error');
      }
    }
  },

  openNewBoqModal() {
    document.getElementById('boqModalForm').reset();
    document.getElementById('boqModalId').value = '';
    const nextNo = `${(this.data?.boq?.length || 0) + 1}.01`;
    document.getElementById('boqModalNo').value = nextNo;
    App.openModal('boqItemModal');
  },

  editBoqItem(id) {
    const b = (this.data.boq || []).find(item => item.id == id);
    if (!b) return;

    document.getElementById('boqModalId').value = b.id;
    document.getElementById('boqModalNo').value = b.item_no;
    document.getElementById('boqModalDesc').value = b.description;
    document.getElementById('boqModalCategory').value = b.category;
    document.getElementById('boqModalUnit').value = b.unit;
    document.getElementById('boqModalContractQty').value = b.contract_qty;
    document.getElementById('boqModalExecutedQty').value = b.executed_qty;
    document.getElementById('boqModalRate').value = b.unit_rate;
    document.getElementById('boqModalStatus').value = b.status || 'جاري التنفيذ';
    document.getElementById('boqModalNotes').value = b.notes || '';

    App.openModal('boqItemModal');
  },

  async submitBoqForm(e) {
    if (e) e.preventDefault();
    const pid = this.getActiveProjectId();
    if (!pid) return App.showToast('يرجى تحديد المشروع أولاً', 'error');

    const id = document.getElementById('boqModalId').value;
    const payload = {
      projectId: pid,
      item_no: document.getElementById('boqModalNo').value,
      description: document.getElementById('boqModalDesc').value,
      category: document.getElementById('boqModalCategory').value,
      unit: document.getElementById('boqModalUnit').value,
      contract_qty: document.getElementById('boqModalContractQty').value,
      executed_qty: document.getElementById('boqModalExecutedQty').value,
      unit_rate: document.getElementById('boqModalRate').value,
      status: document.getElementById('boqModalStatus').value,
      notes: document.getElementById('boqModalNotes').value
    };

    const url = id
      ? `/api/project-hub/${pid}/boq/${id}`
      : `/api/project-hub/${pid}/boq`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ بند جدول الكميات بنجاح', 'success');
      App.closeModal('boqItemModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ البند', 'error');
    }
  },

  async deleteBoqItem(id) {
    if (!confirm('هل أنت متأكد من حذف هذا البند من جدول الكميات؟')) return;
    const pid = this.getActiveProjectId();
    if (!pid) return;
    const res = await fetch(`/api/project-hub/${pid}/boq/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف البند بنجاح', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 4. عروض الأسعار (Quotations & Price Offers)
  // =========================================================================
  renderQuotations() {
    const tbody = document.getElementById('hubQuotationsTableBody');
    if (!tbody || !this.data) return;

    const quotations = this.data.quotations || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (quotations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد عروض أسعار مسجلة لهذا المشروع.</td></tr>`;
      return;
    }

    tbody.innerHTML = quotations.map(q => {
      return `
        <tr>
          <td><strong>${q.quotation_no}</strong></td>
          <td><strong>${q.title}</strong></td>
          <td>${q.date}</td>
          <td>${q.valid_until || '-'}</td>
          <td style="color: var(--gold-light); font-weight: 800;">${App.formatNumber(q.total_amount)} <small>${curr}</small></td>
          <td><span class="drawing-badge-status ${q.status === 'معتمد' ? 'approved' : 'pending'}">${q.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printQuotationDoc(${q.id})" title="طباعة عرض السعر">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteQuotation(${q.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewQuotationModal() {
    document.getElementById('quoModalForm').reset();
    document.getElementById('quoModalNo').value = `QUO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`;
    document.getElementById('quoModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('newQuotationModal');
  },

  async submitQuotationForm(e) {
    if (e) e.preventDefault();
    const payload = {
      quotation_no: document.getElementById('quoModalNo').value,
      title: document.getElementById('quoModalTitle').value,
      date: document.getElementById('quoModalDate').value,
      valid_until: document.getElementById('quoModalValidUntil').value,
      subtotal: document.getElementById('quoModalSubtotal').value,
      discount: document.getElementById('quoModalDiscount').value || 0,
      total_amount: document.getElementById('quoModalTotal').value,
      delivery_period: document.getElementById('quoModalPeriod').value,
      payment_terms: document.getElementById('quoModalPaymentTerms').value,
      status: document.getElementById('quoModalStatus').value,
      notes: document.getElementById('quoModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/quotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم إنشاء عرض السعر بنجاح', 'success');
      App.closeModal('newQuotationModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ عرض السعر', 'error');
    }
  },

  async deleteQuotation(id) {
    if (!confirm('هل تريد حذف عرض السعر؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/quotations/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف عرض السعر', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 5. الميزانية والتكلفة المستهدفة (Budget & Target Cost)
  // =========================================================================
  renderBudgets() {
    const tbody = document.getElementById('hubBudgetsTableBody');
    if (!tbody || !this.data) return;

    const budgets = this.data.budgets || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (budgets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مراكز ميزانية مسجلة.</td></tr>`;
      return;
    }

    let totalPlanned = 0;
    let totalActual = 0;

    tbody.innerHTML = budgets.map(b => {
      const planned = Number(b.planned_cost) || 0;
      const actual = Number(b.actual_cost) || 0;
      const variance = planned - actual;
      const isSaving = variance >= 0;
      const burnPct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;

      totalPlanned += planned;
      totalActual += actual;

      return `
        <tr>
          <td><strong>${b.category}</strong></td>
          <td>${App.formatNumber(planned)} <small>${curr}</small></td>
          <td style="color: ${actual > planned ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight: 700;">
            ${App.formatNumber(actual)} <small>${curr}</small>
          </td>
          <td>
            <span class="budget-variance-pill ${isSaving ? 'saving' : 'overrun'}">
              ${isSaving ? 'توفير +' : 'تجاوز -'}${App.formatNumber(Math.abs(variance))} ${curr}
            </span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="budget-progress-bar-wrap" style="flex: 1;">
                <div class="budget-progress-fill" style="width: ${burnPct}%; background: ${burnPct > 90 ? 'var(--accent-red)' : (burnPct > 60 ? 'var(--gold-primary)' : 'var(--accent-green)')};"></div>
              </div>
              <span style="font-size: 0.72rem; font-weight: 700;">${burnPct}%</span>
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.editBudget(${b.id})" title="تعديل">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteBudget(${b.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td style="color: var(--gold-light);">الإجمالي العام:</td>
        <td style="color: #fff;">${App.formatNumber(totalPlanned)} ${curr}</td>
        <td style="color: ${totalActual > totalPlanned ? 'var(--accent-red)' : 'var(--accent-green)'};">${App.formatNumber(totalActual)} ${curr}</td>
        <td colspan="3" style="color: var(--gold-light);">
          ${totalPlanned >= totalActual ? `صافي الوفر المالي: +${App.formatNumber(totalPlanned - totalActual)} ${curr}` : `إجمالي العجز والتجاوز: -${App.formatNumber(totalActual - totalPlanned)} ${curr}`}
        </td>
      </tr>
    `;
  },

  openNewBudgetModal() {
    document.getElementById('budgetModalForm').reset();
    document.getElementById('budgetModalId').value = '';
    App.openModal('budgetCenterModal');
  },

  editBudget(id) {
    const b = (this.data.budgets || []).find(item => item.id == id);
    if (!b) return;

    document.getElementById('budgetModalId').value = b.id;
    document.getElementById('budgetModalCategory').value = b.category;
    document.getElementById('budgetModalPlanned').value = b.planned_cost;
    document.getElementById('budgetModalActual').value = b.actual_cost;
    document.getElementById('budgetModalNotes').value = b.notes || '';

    App.openModal('budgetCenterModal');
  },

  async submitBudgetForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('budgetModalId').value;
    const payload = {
      category: document.getElementById('budgetModalCategory').value,
      planned_cost: document.getElementById('budgetModalPlanned').value,
      actual_cost: document.getElementById('budgetModalActual').value,
      notes: document.getElementById('budgetModalNotes').value
    };

    const url = id
      ? `/api/project-hub/${this.currentProjectId}/budgets/${id}`
      : `/api/project-hub/${this.currentProjectId}/budgets`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ مركز الميزانية بنجاح', 'success');
      App.closeModal('budgetCenterModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ الميزانية', 'error');
    }
  },

  async deleteBudget(id) {
    if (!confirm('هل تريد حذف مركز الميزانية هذا؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/budgets/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف البند', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 6. أوامر التغيير والإضافيات (Change Orders)
  // =========================================================================
  renderChangeOrders() {
    const tbody = document.getElementById('hubChangeOrdersTableBody');
    if (!tbody || !this.data) return;

    const changeOrders = this.data.changeOrders || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (changeOrders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد أوامر تغيير مسجلة لهذا المشروع.</td></tr>`;
      return;
    }

    let totalAmount = 0;
    tbody.innerHTML = changeOrders.map(c => {
      totalAmount += Number(c.amount) || 0;
      return `
        <tr>
          <td><strong>${c.change_no}</strong></td>
          <td><strong>${c.title}</strong></td>
          <td><span class="badge badge-income" style="background:rgba(212,175,55,0.15); color:var(--gold-light);">${c.type}</span></td>
          <td style="color: var(--gold-light); font-weight: 800;">+${App.formatNumber(c.amount)} <small>${curr}</small></td>
          <td>+${c.time_extension_days || 0} يوم</td>
          <td>${c.reason}</td>
          <td><span class="drawing-badge-status approved">${c.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printChangeOrderSlip(${c.id})" title="طباعة أمر التغيير">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteChangeOrder(${c.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td colspan="3" style="text-align: right; color: var(--gold-light);">إجمالي الأثر المالي لأوامر التغيير:</td>
        <td colspan="5" style="color: var(--gold-light); font-size: 1.05rem;">+${App.formatNumber(totalAmount)} ${curr}</td>
      </tr>
    `;
  },

  openNewChangeOrderModal() {
    document.getElementById('coModalForm').reset();
    document.getElementById('coModalNo').value = `CO-${String((this.data?.changeOrders?.length || 0) + 1).padStart(3, '0')}`;
    document.getElementById('coModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('changeOrderModal');
  },

  async submitChangeOrderForm(e) {
    if (e) e.preventDefault();
    const payload = {
      change_no: document.getElementById('coModalNo').value,
      title: document.getElementById('coModalTitle').value,
      type: document.getElementById('coModalType').value,
      request_date: document.getElementById('coModalDate').value,
      approval_date: document.getElementById('coModalAppDate').value,
      amount: document.getElementById('coModalAmount').value,
      time_extension_days: document.getElementById('coModalDays').value || 0,
      reason: document.getElementById('coModalReason').value,
      status: document.getElementById('coModalStatus').value,
      requested_by: document.getElementById('coModalRequestedBy').value,
      approved_by: document.getElementById('coModalApprovedBy').value,
      notes: document.getElementById('coModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/change-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم توثيق أمر التغيير وتحديث قيمة العقد', 'success');
      App.closeModal('changeOrderModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ أمر التغيير', 'error');
    }
  },

  async deleteChangeOrder(id) {
    if (!confirm('هل تريد حذف أمر التغيير هذا؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/change-orders/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف أمر التغيير', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 7. مشتريات وفواتير المشروع (Project Purchases)
  // =========================================================================
  renderPurchases() {
    const tbody = document.getElementById('hubPurchasesTableBody');
    if (!tbody || !this.data) return;

    const purchases = this.data.purchases || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (purchases.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد فواتير مشتريات مسجلة للمشروع.</td></tr>`;
      return;
    }

    let totalVal = 0;
    let totalPaid = 0;

    tbody.innerHTML = purchases.map(p => {
      totalVal += Number(p.total_amount) || 0;
      totalPaid += Number(p.paid_amount) || 0;
      return `
        <tr>
          <td><strong>${p.invoice_no || '-'}</strong></td>
          <td>${p.date}</td>
          <td><strong>${p.supplier_full_name || p.supplier_name || 'مورد عام'}</strong></td>
          <td>${p.item_description} (${p.quantity} ${p.unit || ''})</td>
          <td style="font-weight: 700;">${App.formatNumber(p.total_amount)} <small>${curr}</small></td>
          <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(p.paid_amount)} <small>${curr}</small></td>
          <td><span class="drawing-badge-status ${p.payment_status === 'مدفوع' ? 'approved' : 'pending'}">${p.payment_status}</span></td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deletePurchase(${p.id})" title="حذف">🗑️</button>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td colspan="4" style="text-align: right; color: var(--gold-light);">إجمالي فواتير المشتريات:</td>
        <td style="color: #fff;">${App.formatNumber(totalVal)} ${curr}</td>
        <td colspan="3" style="color: var(--accent-green);">المسدد: ${App.formatNumber(totalPaid)} ${curr} (المتبقي: ${App.formatNumber(totalVal - totalPaid)} ${curr})</td>
      </tr>
    `;
  },

  openNewPurchaseModal() {
    document.getElementById('projPurModalForm').reset();
    document.getElementById('projPurDate').value = new Date().toISOString().split('T')[0];

    // ملء الموردين
    const select = document.getElementById('projPurSupplier');
    if (select) {
      fetch('/api/suppliers').then(r => r.json()).then(res => {
        if (res.success) {
          select.innerHTML = `<option value="">اختر المورد...</option>` +
            res.data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
      });
    }
    App.openModal('projectPurchaseModal');
  },

  async submitProjectPurchaseForm(e) {
    if (e) e.preventDefault();
    const payload = {
      invoice_no: document.getElementById('projPurInvoiceNo').value,
      supplier_id: document.getElementById('projPurSupplier').value,
      item_description: document.getElementById('projPurDesc').value,
      quantity: document.getElementById('projPurQty').value,
      unit: document.getElementById('projPurUnit').value,
      unit_price: document.getElementById('projPurPrice').value,
      total_amount: document.getElementById('projPurTotal').value,
      paid_amount: document.getElementById('projPurPaid').value,
      payment_status: document.getElementById('projPurStatus').value,
      payment_method: document.getElementById('projPurMethod').value,
      date: document.getElementById('projPurDate').value,
      notes: document.getElementById('projPurNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم تسجيل فاتورة المشتريات وتحديث تكلفة المشروع', 'success');
      App.closeModal('projectPurchaseModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ الفاتورة', 'error');
    }
  },

  async deletePurchase(id) {
    if (!confirm('هل تريد حذف فاتورة المشتريات هذه؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/purchases/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف الفاتورة', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
  // =========================================================================
  renderLabor() {
    const tbody = document.getElementById('hubLaborTableBody');
    if (!tbody || !this.data) return;

    const labor = this.data.labor || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (labor.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مصاريف عمالة مسجلة للمشروع.</td></tr>`;
      return;
    }

    let totalLaborVal = 0;
    tbody.innerHTML = labor.map(l => {
      totalLaborVal += Number(l.total_amount) || 0;
      return `
        <tr>
          <td>${l.date}</td>
          <td><strong>${l.worker_name_or_team}</strong></td>
          <td><span class="badge badge-income" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">${l.trade}</span></td>
          <td>${l.workers_count} عمال</td>
          <td>${App.formatNumber(l.daily_rate)} <small>${curr}</small></td>
          <td style="color: var(--accent-red); font-weight: 700;">${App.formatNumber(l.total_amount)} <small>${curr}</small></td>
          <td>${l.supervisor_name || '-'}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteLabor(${l.id})" title="حذف">🗑️</button>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(239,68,68,0.08); font-weight: 800;">
        <td colspan="5" style="text-align: right; color: var(--accent-red);">إجمالي أجور العمالة والمصروفات الميدانية:</td>
        <td colspan="3" style="color: var(--accent-red); font-size: 1.05rem;">${App.formatNumber(totalLaborVal)} ${curr}</td>
      </tr>
    `;
  },

  openNewLaborModal() {
    document.getElementById('projLaborModalForm').reset();
    document.getElementById('projLaborDate').value = new Date().toISOString().split('T')[0];
    App.openModal('projectLaborModal');
  },

  async submitProjectLaborForm(e) {
    if (e) e.preventDefault();
    const payload = {
      date: document.getElementById('projLaborDate').value,
      worker_name_or_team: document.getElementById('projLaborName').value,
      trade: document.getElementById('projLaborTrade').value,
      workers_count: document.getElementById('projLaborCount').value,
      daily_rate: document.getElementById('projLaborRate').value,
      days_or_hours: document.getElementById('projLaborDays').value || 1,
      total_amount: document.getElementById('projLaborTotal').value,
      expense_category: document.getElementById('projLaborCat').value,
      supervisor_name: document.getElementById('projLaborSupervisor').value,
      notes: document.getElementById('projLaborNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/labor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم تسجيل أجور العمالة والمصروف بنجاح', 'success');
      App.closeModal('projectLaborModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ السجل', 'error');
    }
  },

  async deleteLabor(id) {
    if (!confirm('هل تريد حذف هذا السجل؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/labor/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف السجل', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 9. المستخلصات وشهادات الدفع الرسمية (FIDIC IPC Engine)
  // =========================================================================
  ipcDraftItems: [],

  renderInvoices() {
    const tbody = document.getElementById('hubInvoicesTableBody');
    if (!tbody || !this.data) return;

    const invoices = this.data.invoices || [];
    const project = this.data.project || {};
    const curr = project.currency || 'ر.ي';
    const contractVal = Number(this.data.contract?.contract_value) || Number(project.contract_value) || 0;

    // 1. حساب مؤشرات أداء المستخلصات (KPIs)
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    invoices.forEach(i => {
      const g = Number(i.current_gross_amount) || 0;
      const n = Number(i.net_amount) || 0;
      const d = (Number(i.advance_deduction) || 0) + (Number(i.retention_deduction) || 0) + (Number(i.other_deductions) || 0) + (Number(i.tax_wht_amount) || 0);

      totalGross += g;
      totalDeductions += d;
      totalNet += n;
    });

    const remainingContract = Math.max(0, contractVal - totalGross);

    // تحديث بطاقات الـ KPIs
    const kpiGross = document.getElementById('ipcKpiGrossVal');
    const kpiDed = document.getElementById('ipcKpiDeductionsVal');
    const kpiNet = document.getElementById('ipcKpiNetVal');
    const kpiRem = document.getElementById('ipcKpiRemainingVal');

    if (kpiGross) kpiGross.innerHTML = `${App.formatNumber(totalGross)} <small style="font-size:0.75rem;">${curr}</small>`;
    if (kpiDed) kpiDed.innerHTML = `${App.formatNumber(totalDeductions)} <small style="font-size:0.75rem;">${curr}</small>`;
    if (kpiNet) kpiNet.innerHTML = `${App.formatNumber(totalNet)} <small style="font-size:0.75rem;">${curr}</small>`;
    if (kpiRem) kpiRem.innerHTML = `${App.formatNumber(remainingContract)} <small style="font-size:0.75rem;">${curr}</small>`;

    if (invoices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 35px; color: var(--text-secondary);">لا توجد مستخلصات مسجلة لهذا المشروع بعد. اضغط على "إصدار مستخلص ذكي من جدول الكميات" للبدء.</td></tr>`;
      return;
    }

    tbody.innerHTML = invoices.map(i => {
      const totalDed = (Number(i.advance_deduction) || 0) + (Number(i.retention_deduction) || 0) + (Number(i.other_deductions) || 0) + (Number(i.tax_wht_amount) || 0);
      let itemsCount = i.items_count || 0;
      if (!itemsCount && i.items_json) {
        try { itemsCount = JSON.parse(i.items_json).length; } catch (e) {}
      }

      let itemsBadge = `<span style="font-size: 0.74rem; color: var(--text-secondary);">إجمالي عام</span>`;
      if (itemsCount > 0) {
        itemsBadge = `<button class="btn btn-outline-primary btn-sm" style="padding: 2px 8px; font-size: 0.72rem; border-radius: 12px;" onclick="ProjectHub.viewIpcDetails(${i.id})" title="عرض كشف بنود الكميات المفصلة">${itemsCount} بند مفصل 📊</button>`;
      }

      const periodStr = (i.period_from && i.period_to) ? `${i.period_from} ➔ ${i.period_to}` : (i.period_to || '-');

      return `
        <tr>
          <td><strong style="color: var(--gold-light); font-size: 0.95rem;">${i.invoice_no}</strong></td>
          <td><span class="badge" style="background: rgba(255,255,255,0.05); color: #cbd5e1;">${i.invoice_type}</span></td>
          <td>${i.date}</td>
          <td style="font-size: 0.74rem; color: var(--text-secondary);">${periodStr}</td>
          <td><strong>${App.formatNumber(i.cumulative_work_done)}</strong> <small>${curr}</small></td>
          <td style="font-weight: 700; color: #fff;">${App.formatNumber(i.current_gross_amount)} <small>${curr}</small></td>
          <td style="color: var(--accent-red); font-weight: 700;">-${App.formatNumber(totalDed)} <small>${curr}</small></td>
          <td style="color: var(--accent-green); font-weight: 800; font-size: 1.05rem;">${App.formatNumber(i.net_amount)} <small>${curr}</small></td>
          <td>${itemsBadge}</td>
          <td><span class="drawing-badge-status approved">${i.status || 'معتمد'}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.viewIpcDetails(${i.id})" title="معاينة المستخلص والشهادة">👁️</button>
              <button class="btn btn-primary btn-sm" onclick="ProjectHub.printOfficialIPC(${i.id})" title="طباعة شهادة الدفع الرسمية (PDF)">🖨️</button>
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.exportIpcToExcel(${i.id})" title="تصدير إلى Excel (.xlsx)">📊</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteInvoice(${i.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(16,185,129,0.08); font-weight: 800;">
        <td colspan="4" style="text-align: right; color: var(--accent-green);">إجمالي المستخلصات المعتمدة:</td>
        <td style="color: #fff;"></td>
        <td style="color: #fff; font-size: 1.05rem;">${App.formatNumber(totalGross)} ${curr}</td>
        <td style="color: var(--accent-red); font-size: 1.05rem;">-${App.formatNumber(totalDeductions)} ${curr}</td>
        <td style="color: var(--accent-green); font-size: 1.15rem;" colspan="4">صافي المستحق للمقاول: ${App.formatNumber(totalNet)} ${curr}</td>
      </tr>
    `;
  },

  async openNewInvoiceModal(fromBoq = true) {
    document.getElementById('ipcModalForm').reset();
    this.ipcDraftItems = [];

    const radioBoq = document.querySelector('input[name="ipcMode"][value="boq"]');
    const radioManual = document.querySelector('input[name="ipcMode"][value="manual"]');

    if (fromBoq && radioBoq) {
      radioBoq.checked = true;
    } else if (radioManual) {
      radioManual.checked = true;
    }
    this.toggleIpcMode();

    const curr = this.data?.project?.currency || 'ر.ي';
    const currSpan = document.getElementById('ipcModalCurrency');
    if (currSpan) currSpan.innerText = curr;

    if (fromBoq) {
      try {
        const res = await fetch(`/api/project-hub/${this.currentProjectId}/invoices/prepare-from-boq`);
        const json = await res.json();
        if (json.success && json.draft) {
          const d = json.draft;
          document.getElementById('ipcModalNo').value = d.invoice_no;
          document.getElementById('ipcModalDate').value = d.period_to;
          document.getElementById('ipcModalFromDate').value = d.period_from;
          document.getElementById('ipcModalToDate').value = d.period_to;
          document.getElementById('ipcModalPrevBills').value = d.previous_bills_amount;
          document.getElementById('ipcModalGross').value = d.current_gross_amount;
          document.getElementById('ipcModalCumWork').value = d.cumulative_work_done;
          document.getElementById('ipcModalAdvPct').value = d.advance_pct;
          document.getElementById('ipcModalAdvDed').value = d.advance_deduction;
          document.getElementById('ipcModalRetPct').value = d.retention_pct;
          document.getElementById('ipcModalRetDed').value = d.retention_deduction;
          document.getElementById('ipcModalOtherDed').value = 0;

          this.ipcDraftItems = d.items || [];
          this.renderIpcBoqItemsTable();
          this.calcIpcNet();
        }
      } catch (err) {
        console.error('Error preparing draft IPC:', err);
      }
    } else {
      const nextNo = `IPC-${String((this.data?.invoices?.length || 0) + 1).padStart(2, '0')}`;
      document.getElementById('ipcModalNo').value = nextNo;
      document.getElementById('ipcModalDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('ipcModalAdvPct').value = this.data?.contract?.advance_payment_pct || 10;
      document.getElementById('ipcModalRetPct').value = this.data?.contract?.retention_pct || 10;
      this.calcIpcNet();
    }

    App.openModal('newIpcModal');
  },

  toggleIpcMode() {
    const mode = document.querySelector('input[name="ipcMode"]:checked')?.value || 'boq';
    const section = document.getElementById('ipcBoqItemsSection');
    const actions = document.getElementById('ipcBoqActionBtns');

    if (mode === 'boq') {
      if (section) section.style.display = 'block';
      if (actions) actions.style.display = 'flex';
    } else {
      if (section) section.style.display = 'none';
      if (actions) actions.style.display = 'none';
      this.ipcDraftItems = [];
    }
  },

  renderIpcBoqItemsTable() {
    const tbody = document.getElementById('ipcBoqItemsTableBody');
    const summary = document.getElementById('ipcBoqItemsSummaryText');
    if (!tbody) return;

    if (!this.ipcDraftItems || this.ipcDraftItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد بنود في جدول الكميات BOQ مسجلة لهذا المشروع.</td></tr>`;
      if (summary) summary.innerText = '0 بند';
      return;
    }

    if (summary) summary.innerText = `${this.ipcDraftItems.length} بند مدرج في جدول الكميات`;

    tbody.innerHTML = this.ipcDraftItems.map((it, idx) => {
      return `
        <tr>
          <td><strong style="color: var(--gold-light);">${it.item_no}</strong></td>
          <td>
            <div style="font-weight: 600; color: #fff;">${it.description}</div>
            <div style="font-size: 0.68rem; color: var(--text-secondary);">${it.category || ''}</div>
          </td>
          <td style="text-align: center;">${it.unit}</td>
          <td>${App.formatNumber(it.contract_qty)}</td>
          <td style="color: var(--text-secondary);">${App.formatNumber(it.previous_qty || 0)}</td>
          <td style="background: rgba(212,175,55,0.06);">
            <input type="number" step="0.01" min="0" value="${it.current_qty || 0}"
                   class="form-control form-control-sm"
                   style="width: 85px; font-weight: 700; color: var(--gold-light); background: rgba(0,0,0,0.3); border-color: rgba(212,175,55,0.4);"
                   oninput="ProjectHub.onIpcItemQtyChange(${idx}, this.value)">
          </td>
          <td><strong id="ipcRowCumQty_${idx}">${App.formatNumber(it.cumulative_qty || 0)}</strong></td>
          <td>${App.formatNumber(it.unit_rate)}</td>
          <td style="color: var(--gold-light); font-weight: 700;" id="ipcRowCurAmt_${idx}">${App.formatNumber(it.current_amount || 0)}</td>
          <td id="ipcRowPct_${idx}"><span class="badge" style="background: rgba(255,255,255,0.05);">${it.completion_pct || 0}%</span></td>
        </tr>
      `;
    }).join('');
  },

  onIpcItemQtyChange(idx, val) {
    const it = this.ipcDraftItems[idx];
    if (!it) return;

    const curQty = Math.max(0, Number(val) || 0);
    const rate = Number(it.unit_rate) || 0;
    const prevQty = Number(it.previous_qty) || 0;
    const cQty = Number(it.contract_qty) || 0;

    it.current_qty = curQty;
    it.current_amount = curQty * rate;
    it.cumulative_qty = prevQty + curQty;
    it.cumulative_amount = it.cumulative_qty * rate;
    it.completion_pct = cQty > 0 ? Math.min(100, Math.round((it.cumulative_qty / cQty) * 100)) : 0;

    // تحديث قيم السطر في الواجهة
    const elCum = document.getElementById(`ipcRowCumQty_${idx}`);
    const elAmt = document.getElementById(`ipcRowCurAmt_${idx}`);
    const elPct = document.getElementById(`ipcRowPct_${idx}`);

    if (elCum) elCum.innerText = App.formatNumber(it.cumulative_qty);
    if (elAmt) elAmt.innerText = App.formatNumber(it.current_amount);
    if (elPct) elPct.innerHTML = `<span class="badge" style="background: rgba(255,255,255,0.05);">${it.completion_pct}%</span>`;

    // إعادة جمع الأعمال الحالية والتراكمية
    const grossSum = this.ipcDraftItems.reduce((acc, item) => acc + (Number(item.current_amount) || 0), 0);
    const prevBills = Number(document.getElementById('ipcModalPrevBills')?.value) || 0;

    document.getElementById('ipcModalGross').value = grossSum;
    document.getElementById('ipcModalCumWork').value = prevBills + grossSum;

    this.calcIpcNet();
  },

  fillIpcWithSiteProgress() {
    if (!this.ipcDraftItems || this.ipcDraftItems.length === 0) return;
    const boqMap = {};
    (this.data?.boq || []).forEach(b => { boqMap[b.id] = Number(b.executed_qty) || 0; });

    this.ipcDraftItems.forEach((it, idx) => {
      const siteExec = boqMap[it.boq_item_id] !== undefined ? boqMap[it.boq_item_id] : (Number(it.contract_qty) || 0);
      const prev = Number(it.previous_qty) || 0;
      const cur = Math.max(0, siteExec - prev);

      it.current_qty = cur;
      it.current_amount = cur * (Number(it.unit_rate) || 0);
      it.cumulative_qty = prev + cur;
      it.cumulative_amount = it.cumulative_qty * (Number(it.unit_rate) || 0);
      it.completion_pct = it.contract_qty > 0 ? Math.min(100, Math.round((it.cumulative_qty / it.contract_qty) * 100)) : 0;
    });

    this.renderIpcBoqItemsTable();

    const grossSum = this.ipcDraftItems.reduce((acc, item) => acc + (Number(item.current_amount) || 0), 0);
    const prevBills = Number(document.getElementById('ipcModalPrevBills')?.value) || 0;

    document.getElementById('ipcModalGross').value = grossSum;
    document.getElementById('ipcModalCumWork').value = prevBills + grossSum;

    this.calcIpcNet();
    App.showToast('تمت تعبئة المستخلص بنسب الإنجاز المنفذة فعلياً بالموقع ⚡', 'info');
  },

  resetIpcItemQuantities() {
    if (!this.ipcDraftItems) return;
    this.ipcDraftItems.forEach(it => {
      it.current_qty = 0;
      it.current_amount = 0;
      it.cumulative_qty = Number(it.previous_qty) || 0;
      it.cumulative_amount = it.cumulative_qty * (Number(it.unit_rate) || 0);
      it.completion_pct = it.contract_qty > 0 ? Math.min(100, Math.round((it.cumulative_qty / it.contract_qty) * 100)) : 0;
    });

    this.renderIpcBoqItemsTable();

    const prevBills = Number(document.getElementById('ipcModalPrevBills')?.value) || 0;
    document.getElementById('ipcModalGross').value = 0;
    document.getElementById('ipcModalCumWork').value = prevBills;

    this.calcIpcNet();
  },

  calcIpcNet(isManualDeduction = false) {
    const gross = Number(document.getElementById('ipcModalGross')?.value) || 0;
    const prev = Number(document.getElementById('ipcModalPrevBills')?.value) || 0;
    const cum = Number(document.getElementById('ipcModalCumWork')?.value) || 0;

    const advPct = Number(document.getElementById('ipcModalAdvPct')?.value) || 0;
    const retPct = Number(document.getElementById('ipcModalRetPct')?.value) || 0;

    let advDed = Number(document.getElementById('ipcModalAdvDed')?.value) || 0;
    let retDed = Number(document.getElementById('ipcModalRetDed')?.value) || 0;
    const otherDed = Number(document.getElementById('ipcModalOtherDed')?.value) || 0;

    if (!isManualDeduction) {
      advDed = Math.round((gross * advPct) / 100);
      retDed = Math.round((gross * retPct) / 100);
      document.getElementById('ipcModalAdvDed').value = advDed;
      document.getElementById('ipcModalRetDed').value = retDed;
    }

    const totalDed = advDed + retDed + otherDed;
    const net = Math.max(0, gross - totalDed);

    document.getElementById('ipcModalNet').value = net;
    document.getElementById('ipcModalNetDisplay').innerText = App.formatNumber(net);

    // التفقيط المالي بالريال بالحروف
    const curr = this.data?.project?.currency || 'ر.ي';
    let tafqeetText = '';
    if (typeof Tafqeet !== 'undefined' && Tafqeet.tafqeet) {
      tafqeetText = Tafqeet.tafqeet(net, curr);
    } else {
      tafqeetText = `${App.formatNumber(net)} ${curr}`;
    }
    const tafqeetEl = document.getElementById('ipcModalTafqeetDisplay');
    if (tafqeetEl) tafqeetEl.innerText = tafqeetText;
  },

  async submitInvoiceForm(e) {
    if (e) e.preventDefault();
    const payload = {
      invoice_no: document.getElementById('ipcModalNo').value,
      invoice_type: document.getElementById('ipcModalType').value,
      period_from: document.getElementById('ipcModalFromDate').value,
      period_to: document.getElementById('ipcModalToDate').value,
      cumulative_work_done: document.getElementById('ipcModalCumWork').value,
      previous_bills_amount: document.getElementById('ipcModalPrevBills').value || 0,
      current_gross_amount: document.getElementById('ipcModalGross').value,
      advance_pct: document.getElementById('ipcModalAdvPct').value || 10,
      advance_deduction: document.getElementById('ipcModalAdvDed').value || 0,
      retention_pct: document.getElementById('ipcModalRetPct').value || 10,
      retention_deduction: document.getElementById('ipcModalRetDed').value || 0,
      other_deductions: document.getElementById('ipcModalOtherDed').value || 0,
      net_amount: document.getElementById('ipcModalNet').value,
      status: document.getElementById('ipcModalStatus').value,
      date: document.getElementById('ipcModalDate').value,
      notes: document.getElementById('ipcModalNotes').value,
      items: this.ipcDraftItems || []
    };

    try {
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.success) {
        App.showToast('تم إصدار واعتماد شهادة المستخلص بنجاح ومزامنة جدول الكميات 📑', 'success');
        App.closeModal('newIpcModal');
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'فشل في حفظ المستخلص', 'error');
      }
    } catch (err) {
      console.error('Error submitting IPC:', err);
      App.showToast('حدث خطأ أثناء حفظ المستخلص', 'error');
    }
  },

  async viewIpcDetails(id) {
    try {
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/invoices/${id}`);
      const json = await res.json();
      if (!json.success || !json.data) {
        App.showToast('تعذر جلب تفاصيل المستخلص', 'error');
        return;
      }

      const inv = json.data;
      const proj = inv.project || this.data?.project || {};
      const curr = proj.currency || 'ر.ي';
      const items = inv.items || [];
      const totalDed = (Number(inv.advance_deduction) || 0) + (Number(inv.retention_deduction) || 0) + (Number(inv.other_deductions) || 0);

      document.getElementById('ipcDetailsModalTitle').innerText = `شهادة المستخلص الجاري المعتمد (${inv.invoice_no})`;
      document.getElementById('ipcDetailsModalSubtitle').innerText = `مشروع: ${proj.name} | التاريخ: ${inv.date} | الفترة: ${inv.period_from || '-'} إلى ${inv.period_to || '-'}`;

      document.getElementById('ipcDetailsPrintBtn').dataset.id = inv.id;
      document.getElementById('ipcDetailsExcelBtn').dataset.id = inv.id;

      let itemsHtml = '';
      if (items.length > 0) {
        itemsHtml = `
          <div style="margin-top: 18px;">
            <h5 style="color: var(--gold-light); margin-bottom: 8px;">كشف تفريغ وحصر بنود جدول الكميات للمستخلص:</h5>
            <div style="max-height: 240px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-sm);">
              <table class="custom-table" style="font-size: 0.76rem;">
                <thead style="position: sticky; top: 0; background: var(--bg-surface); z-index: 2;">
                  <tr>
                    <th>رقم البند</th>
                    <th>بيان الأعمال</th>
                    <th>الوحدة</th>
                    <th>كمية العقد</th>
                    <th>كمية سابقة</th>
                    <th>كمية حالية</th>
                    <th>إجمالي كمية</th>
                    <th>فئة السعر</th>
                    <th>قيمة حالية</th>
                    <th>نسبة الإنجاز</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(it => `
                    <tr>
                      <td><strong style="color: var(--gold-light);">${it.item_no}</strong></td>
                      <td>${it.description}</td>
                      <td>${it.unit}</td>
                      <td>${App.formatNumber(it.contract_qty)}</td>
                      <td>${App.formatNumber(it.previous_qty || 0)}</td>
                      <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(it.current_qty || 0)}</td>
                      <td><strong>${App.formatNumber(it.cumulative_qty || (Number(it.previous_qty || 0) + Number(it.current_qty || 0)))}</strong></td>
                      <td>${App.formatNumber(it.unit_rate)}</td>
                      <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(it.current_amount || 0)}</td>
                      <td><span class="badge" style="background: rgba(255,255,255,0.05);">${it.completion_pct || 0}%</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }

      document.getElementById('ipcDetailsContent').innerHTML = `
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 14px; margin-bottom: 14px;">
          <!-- البيانات التعاقدية والمالية -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 14px;">
            <table class="custom-table" style="font-size: 0.82rem; margin: 0;">
              <tbody>
                <tr>
                  <td style="color: var(--text-secondary); width: 40%;">إجمالي الأعمال التراكمية حتى تاريخه:</td>
                  <td><strong style="color: #fff;">${App.formatNumber(inv.cumulative_work_done)}</strong> ${curr}</td>
                </tr>
                <tr>
                  <td style="color: var(--text-secondary);">يُخصم: المستخلصات السابقة المصروفة:</td>
                  <td style="color: var(--accent-red); font-weight: 700;">-${App.formatNumber(inv.previous_bills_amount)} ${curr}</td>
                </tr>
                <tr style="background: rgba(212,175,55,0.06);">
                  <td style="color: var(--gold-light); font-weight: 700;">قيمة الأعمال الجارية الحالية (Gross Work):</td>
                  <td style="color: var(--gold-light); font-weight: 800; font-size: 1rem;">${App.formatNumber(inv.current_gross_amount)} ${curr}</td>
                </tr>
                <tr>
                  <td style="color: var(--text-secondary);">يُخصم: استهلاك الدفعة المقدمة (${inv.advance_pct || 10}%):</td>
                  <td style="color: var(--accent-red);">-${App.formatNumber(inv.advance_deduction)} ${curr}</td>
                </tr>
                <tr>
                  <td style="color: var(--text-secondary);">يُخصم: محتجزات ضمان الأعمال Retention (${inv.retention_pct || 10}%):</td>
                  <td style="color: var(--accent-red);">-${App.formatNumber(inv.retention_deduction)} ${curr}</td>
                </tr>
                ${inv.other_deductions > 0 ? `<tr><td style="color: var(--text-secondary);">استقطاعات وغرامات أخرى:</td><td style="color: var(--accent-red);">-${App.formatNumber(inv.other_deductions)} ${curr}</td></tr>` : ''}
              </tbody>
            </table>
          </div>

          <!-- البطاقة التنفيذية لصافي الصرف -->
          <div style="background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(14,28,50,0.6) 100%); border: 1px solid rgba(34,197,94,0.35); border-radius: var(--radius-sm); padding: 16px; display: flex; flex-direction: column; justify-content: center;">
            <span style="font-size: 0.76rem; color: var(--text-secondary);">صافي المبلغ المستحق للصرف للمقاول:</span>
            <h2 style="color: var(--accent-green); font-size: 1.6rem; margin: 6px 0 10px 0;">${App.formatNumber(inv.net_amount)} <small style="font-size: 0.85rem;">${curr}</small></h2>
            <div style="background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; line-height: 1.4; color: #fff;">
              <span style="color: var(--gold-light); font-size: 0.72rem; display: block;">المبلغ كتابةً:</span>
              ${inv.tafqeet || '-'}
            </div>
            <div style="margin-top: 10px; display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-secondary);">
              <span>الحالة: <strong style="color: #fff;">${inv.status}</strong></span>
              <span>تاريخ الإصدار: <strong>${inv.date}</strong></span>
            </div>
          </div>
        </div>

        ${itemsHtml}
      `;

      App.openModal('ipcDetailsModal');
    } catch (err) {
      console.error('Error viewing IPC details:', err);
      App.showToast('حدث خطأ أثناء تحميل بيانات المستخلص', 'error');
    }
  },

  exportIpcToExcel(id) {
    const fileName = `مستخلص_مشروع_${id}.xlsx`;
    this.downloadBlobFile(`/api/project-hub/${this.currentProjectId}/invoices/${id}/export-excel`, fileName);
  },

  async deleteInvoice(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المستخلص نهائياً؟')) return;
    try {
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/invoices/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم حذف المستخلص بنجاح', 'info');
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'فشل في حذف المستخلص', 'error');
      }
    } catch (err) {
      App.showToast('حدث خطأ أثناء حذف المستخلص', 'error');
    }
  },

  // =========================================================================
  // 10. التقارير اليومية للموقع (Daily Site Reports)
  // =========================================================================
  renderDailyReports() {
    const container = document.getElementById('hubDailyReportsList');
    if (!container || !this.data) return;

    const reports = this.data.dailyReports || [];
    if (reports.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">لا توجد تقارير يومية مسجلة لهذا المشروع بعد.</div>`;
      return;
    }

    container.innerHTML = reports.map(r => `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-light); padding-bottom: 10px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-weight: 800; color: var(--gold-light); font-size: 1.02rem;">${r.report_no}</span>
            <span style="color: var(--text-secondary); font-size: 0.82rem; margin-right: 10px;">📅 التاريخ: <strong>${r.date}</strong></span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span class="badge badge-income" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">👷 العمالة: ${r.manpower_count}</span>
            <span class="badge badge-income" style="background:rgba(212,175,55,0.15); color:var(--gold-light);">☀️ الطقس: ${r.weather}</span>
            <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printDailyReportDoc(${r.id})" title="طباعة">🖨️</button>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteDailyReport(${r.id})" title="حذف">🗑️</button>
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <h5 style="color: #fff; margin-bottom: 4px; font-size: 0.88rem;">🔨 الأعمال المنفذة خلال اليوم:</h5>
          <div style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.6; color: #e2e8f0;">
            ${r.work_performed}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.82rem; color: var(--text-secondary);">
          <div><strong>المعدات العاملة:</strong> ${r.equipment_summary || 'معدات يدوية واعتيادية'}</div>
          <div><strong>المواد الموردة:</strong> ${r.materials_received || 'لا توجد توريدات اليوم'}</div>
          <div><strong>السلامة والجودة:</strong> ${r.safety_notes || 'مطابق لمعايير السلامة'}</div>
          <div><strong>المهندس المشرف:</strong> <strong style="color:var(--gold-light)">${r.site_engineer || 'م. الموقع'}</strong></div>
        </div>
      </div>
    `).join('');
  },

  openNewDailyReportModal() {
    document.getElementById('dailyReportModalForm').reset();
    document.getElementById('dailyModalNo').value = `DR-${new Date().getFullYear()}-${String((this.data?.dailyReports?.length || 0) + 1).padStart(3, '0')}`;
    document.getElementById('dailyModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('dailyReportModal');
  },

  async submitDailyReportForm(e) {
    if (e) e.preventDefault();
    const payload = {
      report_no: document.getElementById('dailyModalNo').value,
      date: document.getElementById('dailyModalDate').value,
      weather: document.getElementById('dailyModalWeather').value,
      manpower_count: document.getElementById('dailyModalManpower').value,
      equipment_summary: document.getElementById('dailyModalEquipment').value,
      work_performed: document.getElementById('dailyModalWork').value,
      materials_received: document.getElementById('dailyModalMaterials').value,
      safety_notes: document.getElementById('dailyModalSafety').value,
      delays_obstacles: document.getElementById('dailyModalDelays').value,
      site_engineer: document.getElementById('dailyModalEngineer').value,
      notes: document.getElementById('dailyModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/daily-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم توثيق التقرير اليومي بنجاح', 'success');
      App.closeModal('dailyReportModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ التقرير', 'error');
    }
  },

  async deleteDailyReport(id) {
    if (!confirm('هل تريد حذف هذا التقرير اليومي؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/daily-reports/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف التقرير', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 11. التقارير الأسبوعية للموقع (Weekly Site Reports)
  // =========================================================================
  renderWeeklyReports() {
    const container = document.getElementById('hubWeeklyReportsList');
    if (!container || !this.data) return;

    const reports = this.data.weeklyReports || [];
    if (reports.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">لا توجد تقارير أسبوعية مسجلة.</div>`;
      return;
    }

    container.innerHTML = reports.map(w => `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-light); padding-bottom: 10px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-weight: 800; color: var(--gold-light); font-size: 1.05rem;">${w.report_no} (الأسبوع ${w.week_no || '1'})</span>
            <span style="color: var(--text-secondary); font-size: 0.82rem; margin-right: 10px;">الفترة من <strong>${w.date_from}</strong> إلى <strong>${w.date_to}</strong></span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge badge-income" style="background:rgba(16,185,129,0.15); color:var(--accent-green);">الإنجاز الفعلي: ${w.actual_progress_pct}%</span>
            <span class="badge badge-income" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">المخطط: ${w.planned_progress_pct}%</span>
            <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printWeeklyReportDoc(${w.id})" title="طباعة">🖨️</button>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteWeeklyReport(${w.id})" title="حذف">🗑️</button>
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <h5 style="color: #fff; margin-bottom: 4px; font-size: 0.88rem;">📊 ملخص إنجازات وأعمال الأسبوع:</h5>
          <div style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.6; color: #e2e8f0;">
            ${w.achievements_summary}
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <h5 style="color: var(--gold-light); margin-bottom: 4px; font-size: 0.88rem;">🎯 خطة العمل المستهدفة للأسبوع القادم:</h5>
          <div style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.6; color: #e2e8f0;">
            ${w.next_week_plan || 'متابعة الأعمال المجدولة.'}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary); border-top: 1px dashed var(--border-light); padding-top: 8px;">
          <div>إعداد المهندس: <strong>${w.prepared_by || 'م. المشروع'}</strong></div>
          <div>اعتماد الإدارة: <strong>${w.approved_by || 'المدير العام'}</strong></div>
        </div>
      </div>
    `).join('');
  },

  openNewWeeklyReportModal() {
    document.getElementById('weeklyReportModalForm').reset();
    document.getElementById('weeklyModalNo').value = `WR-${new Date().getFullYear()}-${String((this.data?.weeklyReports?.length || 0) + 1).padStart(3, '0')}`;
    App.openModal('weeklyReportModal');
  },

  async submitWeeklyReportForm(e) {
    if (e) e.preventDefault();
    const payload = {
      report_no: document.getElementById('weeklyModalNo').value,
      week_no: document.getElementById('weeklyModalWeekNo').value,
      date_from: document.getElementById('weeklyModalFromDate').value,
      date_to: document.getElementById('weeklyModalToDate').value,
      planned_progress_pct: document.getElementById('weeklyModalPlanned').value,
      actual_progress_pct: document.getElementById('weeklyModalActual').value,
      achievements_summary: document.getElementById('weeklyModalAchievements').value,
      next_week_plan: document.getElementById('weeklyModalNextPlan').value,
      critical_issues: document.getElementById('weeklyModalIssues').value,
      prepared_by: document.getElementById('weeklyModalPreparedBy').value,
      approved_by: document.getElementById('weeklyModalApprovedBy').value,
      notes: document.getElementById('weeklyModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/weekly-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ التقرير الأسبوعي بنجاح', 'success');
      App.closeModal('weeklyReportModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ التقرير', 'error');
    }
  },

  async deleteWeeklyReport(id) {
    if (!confirm('هل تريد حذف التقرير الأسبوعي؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/weekly-reports/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف التقرير', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 12. محاضر الاستلام والفحص الهندسي (Handover Minutes)
  // =========================================================================
  renderHandovers() {
    const tbody = document.getElementById('hubHandoversTableBody');
    if (!tbody || !this.data) return;

    const handovers = this.data.handovers || [];
    if (handovers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد محاضر استلام مسجلة.</td></tr>`;
      return;
    }

    tbody.innerHTML = handovers.map(h => {
      let badgeClass = 'approved';
      if (h.status === 'مقبول بملاحظات') badgeClass = 'with-notes';
      else if (h.status === 'مرفوض ويعاد الفحص') badgeClass = 'rejected';

      return `
        <tr>
          <td><strong>${h.minute_no}</strong></td>
          <td><strong>${h.type}</strong></td>
          <td>${h.location_axis || '-'}</td>
          <td>${h.inspection_date}</td>
          <td><strong>${h.inspector_name}</strong></td>
          <td><span class="drawing-badge-status ${badgeClass}">${h.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printHandoverDoc(${h.id})" title="طباعة المحضر">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteHandover(${h.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewHandoverModal() {
    document.getElementById('handoverModalForm').reset();
    document.getElementById('handoverModalNo').value = `IR-${new Date().getFullYear()}-${String((this.data?.handovers?.length || 0) + 1).padStart(3, '0')}`;
    document.getElementById('handoverModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('handoverMinuteModal');
  },

  async submitHandoverForm(e) {
    if (e) e.preventDefault();
    const payload = {
      minute_no: document.getElementById('handoverModalNo').value,
      type: document.getElementById('handoverModalType').value,
      location_axis: document.getElementById('handoverModalLoc').value,
      inspection_date: document.getElementById('handoverModalDate').value,
      inspector_name: document.getElementById('handoverModalInspector').value,
      contractor_rep: document.getElementById('handoverModalContractor').value,
      status: document.getElementById('handoverModalStatus').value,
      punch_list: document.getElementById('handoverModalPunch').value,
      recommendations: document.getElementById('handoverModalRec').value,
      notes: document.getElementById('handoverModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/handovers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم توثيق محضر الاستلام والفحص بنجاح', 'success');
      App.closeModal('handoverMinuteModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المحضر', 'error');
    }
  },

  async deleteHandover(id) {
    if (!confirm('هل تريد حذف محضر الاستلام؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/handovers/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف المحضر', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 13. المراسلات مع المالك والاستشاري (Correspondence)
  // =========================================================================
  renderCorrespondence() {
    const tbody = document.getElementById('hubCorrespondenceTableBody');
    if (!tbody || !this.data) return;

    const corr = this.data.correspondence || [];
    if (corr.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مراسلات أو خطابات مسجلة.</td></tr>`;
      return;
    }

    tbody.innerHTML = corr.map(c => {
      const isOut = c.direction.includes('صادر');
      return `
        <tr>
          <td><strong>${c.ref_no}</strong></td>
          <td><span class="corr-direction-badge ${isOut ? 'outgoing' : 'incoming'}">${c.direction}</span></td>
          <td>${c.date}</td>
          <td><strong>${c.subject}</strong></td>
          <td>${c.priority || 'عادي'}</td>
          <td>${c.sender} &rarr; ${c.recipient}</td>
          <td><span class="drawing-badge-status approved">${c.response_status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printCorrespondenceDoc(${c.id})" title="طباعة الخطاب">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteCorrespondence(${c.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewCorrespondenceModal() {
    document.getElementById('corrModalForm').reset();
    document.getElementById('corrModalDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('corrModalNo').value = `COR-OUT-${new Date().getFullYear()}-${String((this.data?.correspondence?.length || 0) + 1).padStart(3, '0')}`;
    App.openModal('correspondenceModal');
  },

  async submitCorrespondenceForm(e) {
    if (e) e.preventDefault();
    const payload = {
      ref_no: document.getElementById('corrModalNo').value,
      direction: document.getElementById('corrModalDirection').value,
      subject: document.getElementById('corrModalSubject').value,
      date: document.getElementById('corrModalDate').value,
      priority: document.getElementById('corrModalPriority').value,
      summary_body: document.getElementById('corrModalBody').value,
      required_action: document.getElementById('corrModalAction').value,
      response_status: document.getElementById('corrModalStatus').value,
      sender: document.getElementById('corrModalSender').value,
      recipient: document.getElementById('corrModalRecipient').value,
      attachment_name: document.getElementById('corrModalAttachment').value,
      notes: document.getElementById('corrModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/correspondence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم أرشفة المراسلة والخطاب بنجاح', 'success');
      App.closeModal('correspondenceModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المراسلة', 'error');
    }
  },

  async deleteCorrespondence(id) {
    if (!confirm('هل تريد حذف هذا الخطاب من الأرشيف؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/correspondence/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف الخطاب', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 14. الحساب الختامي وتصفية المشروع (Final Settlement)
  // =========================================================================
  renderSettlement() {
    const container = document.getElementById('hubSettlementContent');
    if (!container || !this.data) return;

    const { project, stats, settlement } = this.data;
    const curr = project.currency || 'ر.ي';

    const origVal = stats.originalContractValue || 0;
    const changeOrdersVal = stats.totalApprovedChangeOrders || 0;
    const revisedVal = stats.revisedContractValue || (origVal + changeOrdersVal);
    const executedVal = (settlement && settlement.total_executed_work_val) ? settlement.total_executed_work_val : revisedVal;
    const paymentsReceived = (settlement && settlement.total_client_payments_received) ? settlement.total_client_payments_received : (stats.totalInvoicesNet || 0);
    const releasedRetention = (settlement && settlement.released_retention_val) ? settlement.released_retention_val : (origVal * 0.1);
    const penalties = (settlement && settlement.penalties_deductions_val) ? settlement.penalties_deductions_val : 0;
    const finalBalance = (settlement && settlement.final_balance_due !== undefined) ? settlement.final_balance_due : Math.max(0, (executedVal - paymentsReceived + releasedRetention - penalties));

    container.innerHTML = `
      <div class="settlement-summary-card">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(212,175,55,0.3); padding-bottom: 12px; margin-bottom: 16px;">
          <div>
            <span style="font-size: 0.76rem; color: var(--gold-light);">سند التصفية الختامية: ${settlement ? settlement.settlement_no : `SET-PRJ-${this.currentProjectId}`}</span>
            <h3 style="color: #fff; margin: 4px 0 0 0;">شهادة الحساب الختامي والمخالصة المالية والتشغيلية</h3>
          </div>
          <span class="drawing-badge-status approved">${settlement ? settlement.status : 'جاهز للاعتماد'}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px;">
          <div>
            <h5 style="color: var(--gold-light); margin-bottom: 10px;">1. ملخص القيمة التعاقدية والتنفيذية:</h5>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">قيمة العقد الأصلية:</span>
              <strong>${App.formatNumber(origVal)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">إجمالي أوامر التغيير المعتمدة (+):</span>
              <strong style="color: var(--gold-light);">+${App.formatNumber(changeOrdersVal)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: #fff; font-weight: 700;">القيمة التعاقدية المعدلة النهائية:</span>
              <strong style="color: var(--gold-light); font-size: 1.05rem;">${App.formatNumber(revisedVal)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">إجمالي قيمة الأعمال المنفذة فعلياً:</span>
              <strong style="color: var(--accent-green); font-weight: 800;">${App.formatNumber(executedVal)} ${curr}</strong>
            </div>
          </div>

          <div>
            <h5 style="color: var(--gold-light); margin-bottom: 10px;">2. المقبوضات والاستقطاعات والضمان:</h5>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">إجمالي ما تم سداده من المالك (-):</span>
              <strong style="color: var(--accent-blue);">${App.formatNumber(paymentsReceived)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">الإفراج عن محجوز ضمان الأعمال (+):</span>
              <strong style="color: var(--accent-green);">+${App.formatNumber(releasedRetention)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">الغرامات والاستقطاعات الجزائية (-):</span>
              <strong style="color: var(--accent-red);">${App.formatNumber(penalties)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row highlight">
              <span>صافي المستحق الختامي النهائي:</span>
              <span style="font-size: 1.25rem;">${App.formatNumber(finalBalance)} ${curr}</span>
            </div>
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-sm); font-size: 0.86rem; color: #cbd5e1; line-height: 1.6; margin-bottom: 18px;">
          <strong>إقرار ومخالصة:</strong> بموجب هذه الشهادة الختامية، يقر الطرفان بانتهاء كافة الأعمال المنفذة ومطابقتها للمواصفات الهندسية المعتمدة، وتصفية كافة الالتزامات المالية والتعاقدية المتبادلة دون أي مطالبات لاحقة.
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <button class="btn btn-primary" onclick="ProjectHub.printFinalSettlementDoc()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
            <span>طباعة شهادة الحساب الختامي الرسمية (PDF)</span>
          </button>
          <button class="btn btn-secondary" onclick="ProjectHub.openEditSettlementModal()">
            <span>تعديل واعتماد المخالصة ⚖️</span>
          </button>
        </div>
      </div>
    `;
  },

  openEditSettlementModal() {
    if (!this.data) return;
    const { project, stats, settlement } = this.data;
    const origVal = stats.originalContractValue || 0;
    const changeVal = stats.totalApprovedChangeOrders || 0;
    const revVal = origVal + changeVal;

    document.getElementById('settleModalNo').value = settlement ? settlement.settlement_no : `SET-PRJ-${String(this.currentProjectId).padStart(3, '0')}`;
    document.getElementById('settleModalDate').value = settlement ? settlement.date : new Date().toISOString().split('T')[0];
    document.getElementById('settleModalOrig').value = settlement ? settlement.original_contract_val : origVal;
    document.getElementById('settleModalChange').value = settlement ? settlement.approved_change_orders_val : changeVal;
    document.getElementById('settleModalRev').value = settlement ? settlement.revised_contract_val : revVal;
    document.getElementById('settleModalExec').value = settlement ? settlement.total_executed_work_val : revVal;
    document.getElementById('settleModalPaid').value = settlement ? settlement.total_client_payments_received : (stats.totalInvoicesNet || 0);
    document.getElementById('settleModalRet').value = settlement ? settlement.released_retention_val : (origVal * 0.1);
    document.getElementById('settleModalPenalties').value = settlement ? settlement.penalties_deductions_val : 0;
    document.getElementById('settleModalDue').value = settlement ? settlement.final_balance_due : (revVal - (stats.totalInvoicesNet || 0) + (origVal * 0.1));
    document.getElementById('settleModalStatus').value = settlement ? settlement.status : 'معتمد وموقع';
    document.getElementById('settleModalNotes').value = settlement ? (settlement.notes || '') : 'تمت المخالصة والتسليم النهائي للمشروع.';

    App.openModal('settlementModal');
  },

  async submitSettlementForm(e) {
    if (e) e.preventDefault();
    const payload = {
      settlement_no: document.getElementById('settleModalNo').value,
      date: document.getElementById('settleModalDate').value,
      original_contract_val: document.getElementById('settleModalOrig').value,
      approved_change_orders_val: document.getElementById('settleModalChange').value,
      revised_contract_val: document.getElementById('settleModalRev').value,
      total_executed_work_val: document.getElementById('settleModalExec').value,
      total_client_payments_received: document.getElementById('settleModalPaid').value,
      released_retention_val: document.getElementById('settleModalRet').value,
      penalties_deductions_val: document.getElementById('settleModalPenalties').value,
      final_balance_due: document.getElementById('settleModalDue').value,
      status: document.getElementById('settleModalStatus').value,
      notes: document.getElementById('settleModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/settlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم اعتماد المخالصة والحساب الختامي بنجاح', 'success');
      App.closeModal('settlementModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ الحساب الختامي', 'error');
    }
  },

  // =========================================================================
  // دوال الطباعة الرسمية لكافة مستندات المشروع (Official Printable Documents)
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
          { label: 'رقم المستند', val: docRef || 'DOC' },
          { label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` },
          { label: 'المستخدم المسجل بالمشروع', val: userName }
        ], cfg)
      : `<div style="text-align:center; margin-bottom:15px;"><h2 style="color:#0f2744">${cfg.header_title}</h2><h4>${title} - ${docRef}</h4><div>تاريخ ووقت الطباعة: ${todayDate} - ${timeStr} | المستخدم المسجل: ${userName}</div></div>`;

    const sigHtml = (typeof Settings !== 'undefined' && Settings.renderReportSignatures)
      ? Settings.renderReportSignatures(cfg)
      : `<div style="display:flex; justify-content:space-between; margin-top:25px;"><div>مهندس المشروع</div><div>المحاسب المالي</div><div>المدير العام</div></div>`;

    const footerHtml = (typeof Settings !== 'undefined' && Settings.renderReportFooter)
      ? Settings.renderReportFooter(cfg)
      : `<div style="text-align:center; font-size:0.75rem; color:#64748b; margin-top:15px;">${cfg.footer_notes} | المستخدم: ${userName}</div>`;

    return { cfg, headerHtml, sigHtml, footerHtml, todayDate };
  },

  printOfficialContract() {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data || !this.data.contract) return;
    const { contract, project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig('عقد تنفيذ أعمال مقاولات هندسية', contract.contract_no);
    const curr = project.currency || 'ر.ي';

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744; width: 28%;">${project.name} (${project.code})</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">القيمة التعاقدية:</td>
              <td style="font-weight: 800; color: #b8911c; width: 28%;">${App.formatNumber(contract.contract_value)} ${curr}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الطرف الأول (المالك):</td>
              <td>${contract.first_party || project.client_name}</td>
              <td style="font-weight: 800; background: #f1f5f9;">الطرف الثاني (المقاول):</td>
              <td>${contract.second_party}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">مدة العقد:</td>
              <td>${contract.duration_days} يوماً (من ${contract.start_date} إلى ${contract.end_date})</td>
              <td style="font-weight: 800; background: #f1f5f9;">الدفعة المقدمة:</td>
              <td>${contract.advance_payment_pct}% (${App.formatNumber(contract.advance_payment_amount)} ${curr})</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 12px 0 6px 0; border-right: 3px solid #d4af37; padding-right: 8px;">
            البند الأول: نطاق الأعمال والتنفيذ
          </div>
          <p style="font-size: 0.88rem; line-height: 1.7; color: #334155; margin-bottom: 12px; background: #f8fafc; padding: 10px; border-radius: 4px;">
            ${contract.scope_of_work || 'تنفيذ كافة بنود الأعمال الإنشائية والمعمارية وفق المخططات المعتمدة وجدول الكميات.'}
          </p>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 12px 0 6px 0; border-right: 3px solid #d4af37; padding-right: 8px;">
            البند الثاني: الشروط المالية وصرف المستخلصات
          </div>
          <p style="font-size: 0.88rem; line-height: 1.7; color: #334155; margin-bottom: 12px; background: #f8fafc; padding: 10px; border-radius: 4px;">
            ${contract.payment_terms || 'دفعات شهرية مع استقطاع 10% ضمان أعمال وغرامة تأخير يومية عند تجاوز مدة العقد.'}
          </p>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ التقرير تلقائياً في مجلد المشروع الفعلي
    this.saveReportToProjectFolder('عقد', `عقد_المشروع_${contract.contract_no || 'CNT'}`, printArea.innerHTML, 'html', '01_العقود_والمستندات');
    window.print();
  },

  printOfficialIPC(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const inv = (this.data.invoices || []).find(i => i.id == id);
    if (!inv) return;

    const { project } = this.data;
    const contract = this.data.contract || {};
    const { headerHtml, footerHtml } = this.getPrintBaseConfig(`شهادة مستخلص جاري للأعمال (${inv.invoice_no})`, inv.invoice_no);
    const curr = project.currency || 'ر.ي';
    const totalDed = (Number(inv.advance_deduction) || 0) + (Number(inv.retention_deduction) || 0) + (Number(inv.other_deductions) || 0);

    let items = [];
    if (inv.items_json) {
      try { items = JSON.parse(inv.items_json); } catch (e) {}
    }

    let tafqeetText = inv.tafqeet || '';
    if (!tafqeetText) {
      if (typeof Tafqeet !== 'undefined' && Tafqeet.tafqeet) {
        tafqeetText = Tafqeet.tafqeet(inv.net_amount, curr);
      } else {
        tafqeetText = `${App.formatNumber(inv.net_amount)} ${curr}`;
      }
    }

    // جدول تفريغ بنود جدول الكميات إن وجد
    let itemsBreakdownHtml = '';
    if (items.length > 0) {
      itemsBreakdownHtml = `
        <div style="page-break-before: always; margin-top: 25px;">
          <div style="border-bottom: 2px solid #0f2744; padding-bottom: 6px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: baseline;">
            <h4 style="margin: 0; color: #0f2744;">كشف حصر وتفريغ كميات بنود الأعمال للمستخلص رقم (${inv.invoice_no})</h4>
            <span style="font-size: 8pt; color: #64748b;">مشروع: ${project.name}</span>
          </div>

          <table class="official-report-table" style="font-size: 7.5pt; width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #0f2744; color: #fff;">
                <th style="width: 25px; padding: 4px; text-align: center;">م</th>
                <th style="width: 55px; padding: 4px; text-align: center;">رقم البند</th>
                <th style="padding: 4px; text-align: right;">بيان الأعمال والمواصفات</th>
                <th style="width: 35px; padding: 4px; text-align: center;">الوحدة</th>
                <th style="width: 50px; padding: 4px; text-align: center;">كمية العقد</th>
                <th style="width: 50px; padding: 4px; text-align: center;">كمية سابقة</th>
                <th style="width: 50px; padding: 4px; text-align: center; background: #1e3a8a;">كمية حالية</th>
                <th style="width: 55px; padding: 4px; text-align: center;">إجمالي تراكمي</th>
                <th style="width: 50px; padding: 4px; text-align: center;">فئة السعر</th>
                <th style="width: 65px; padding: 4px; text-align: center; background: #1e3a8a;">قيمة حالي</th>
                <th style="width: 65px; padding: 4px; text-align: center;">إجمالي القيمة</th>
                <th style="width: 35px; padding: 4px; text-align: center;">إنجاز %</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((it, idx) => `
                <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 1 ? 'background: #f8fafc;' : ''}">
                  <td style="text-align: center; padding: 4px;">${idx + 1}</td>
                  <td style="text-align: center; padding: 4px; font-weight: bold;">${it.item_no}</td>
                  <td style="padding: 4px; text-align: right;">${it.description}</td>
                  <td style="text-align: center; padding: 4px;">${it.unit}</td>
                  <td style="text-align: center; padding: 4px;">${App.formatNumber(it.contract_qty)}</td>
                  <td style="text-align: center; padding: 4px; color: #64748b;">${App.formatNumber(it.previous_qty || 0)}</td>
                  <td style="text-align: center; padding: 4px; font-weight: bold; background: #eff6ff;">${App.formatNumber(it.current_qty || 0)}</td>
                  <td style="text-align: center; padding: 4px; font-weight: bold;">${App.formatNumber(it.cumulative_qty || (Number(it.previous_qty || 0) + Number(it.current_qty || 0)))}</td>
                  <td style="text-align: center; padding: 4px;">${App.formatNumber(it.unit_rate)}</td>
                  <td style="text-align: center; padding: 4px; font-weight: bold; background: #eff6ff;">${App.formatNumber(it.current_amount || 0)}</td>
                  <td style="text-align: center; padding: 4px; font-weight: bold;">${App.formatNumber(it.cumulative_amount || 0)}</td>
                  <td style="text-align: center; padding: 4px;">${it.completion_pct || 0}%</td>
                </tr>
              `).join('')}
              <tr style="background: #e2e8f0; font-weight: bold; border-top: 2px solid #0f2744;">
                <td colspan="9" style="text-align: right; padding: 6px;">إجمالي الأعمال المنفذة في هذا المستخلص:</td>
                <td style="text-align: center; padding: 6px; color: #0f2744; font-size: 8.5pt;">${App.formatNumber(inv.current_gross_amount)}</td>
                <td style="text-align: center; padding: 6px; color: #0f2744; font-size: 8.5pt;">${App.formatNumber(inv.cumulative_work_done)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    }

    // جدول التوقيعات الرباعي المعتمد
    const officialQuadrupleSignatures = `
      <div style="margin-top: 30px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; border-top: 1.5px solid #0f2744; padding-top: 14px;">
        <div style="text-align: center; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px;">
          <div style="font-size: 8pt; font-weight: bold; color: #475569; margin-bottom: 28px;">مهندس الموقع والمكتب الفني (المقاول)</div>
          <div style="font-size: 8pt; color: #0f2744; border-top: 1px dashed #94a3b8; padding-top: 4px;">الاسم والتوقيع: .....................</div>
        </div>
        <div style="text-align: center; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px;">
          <div style="font-size: 8pt; font-weight: bold; color: #475569; margin-bottom: 28px;">مدير المشروع (المقاول)</div>
          <div style="font-size: 8pt; color: #0f2744; border-top: 1px dashed #94a3b8; padding-top: 4px;">الاسم والتوقيع: .....................</div>
        </div>
        <div style="text-align: center; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; background: #f8fafc;">
          <div style="font-size: 8pt; font-weight: bold; color: #1e3a8a; margin-bottom: 28px;">المهندس الاستشاري المشرف المعتمد</div>
          <div style="font-size: 8pt; color: #1e3a8a; border-top: 1px dashed #94a3b8; padding-top: 4px;">الختم والاعتماد: .....................</div>
        </div>
        <div style="text-align: center; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px;">
          <div style="font-size: 8pt; font-weight: bold; color: #047857; margin-bottom: 28px;">المصادقة والصرف (المالك / صاحب العمل)</div>
          <div style="font-size: 8pt; color: #047857; border-top: 1px dashed #94a3b8; padding-top: 4px;">التوجيه بالصرف: .....................</div>
        </div>
      </div>
    `;

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <!-- بطاقة بيانات المشروع والعقد الرسمية -->
          <table class="official-report-table" style="margin-bottom: 14px; font-size: 8.5pt;">
            <tr>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744;">${project.name}</td>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">الطرف الأول (المالك):</td>
              <td>${inv.client_name || project.client_name || '-'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الطرف الثاني (المقاول):</td>
              <td style="font-weight: bold; color: #d97706;">شركة رواسي عدن للهندسة والمقاولات</td>
              <td style="font-weight: 800; background: #f1f5f9;">قيمة العقد المعتمدة:</td>
              <td style="font-weight: 800; color: #0f2744;">${App.formatNumber(contract.contract_value || project.contract_value)} ${curr}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">رقم المستخلص:</td>
              <td style="font-weight: 900; color: #0f2744;">${inv.invoice_no} (${inv.invoice_type || 'مستخلص جاري'})</td>
              <td style="font-weight: 800; background: #f1f5f9;">الفترة المحاسبية المغطاة:</td>
              <td>من: <strong>${inv.period_from || '-'}</strong> إلى: <strong>${inv.period_to || '-'}</strong></td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ الاعتماد الرسمي:</td>
              <td>${inv.date}</td>
              <td style="font-weight: 800; background: #f1f5f9;">حالة المستخلص:</td>
              <td><strong style="color: #047857;">${inv.status || 'معتمد وجاهز للصرف'}</strong></td>
            </tr>
          </table>

          <!-- جدول شهادة الدفع والملخص المالي المعتمد -->
          <table class="official-report-table" style="margin-bottom: 14px; font-size: 9pt;">
            <thead>
              <tr style="background: #0f2744; color: #fff;">
                <th style="padding: 6px 10px; text-align: right;">البيان المالي والهندسي المعتمد للمستخلص</th>
                <th style="padding: 6px 10px; text-align: center; width: 120px;">النسبة / المرجع</th>
                <th style="padding: 6px 10px; text-align: left; width: 160px;">المبلغ المعتمد (${curr})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1. إجمالي قيمة الأعمال المنفذة التراكمية حتى تاريخه (Gross Cumulative Value):</td>
                <td style="text-align: center; color: #64748b;">تراكمي حتى ${inv.period_to || inv.date}</td>
                <td style="text-align: left; font-weight: bold; font-size: 10pt;">${App.formatNumber(inv.cumulative_work_done)}</td>
              </tr>
              <tr>
                <td>2. يُخصم: إجمالي المستخلصات السابقة المصروفة (Less: Previous IPCs Value):</td>
                <td style="text-align: center; color: #64748b;">مستخلصات سابقة</td>
                <td style="text-align: left; color: #dc2626; font-weight: bold;">-${App.formatNumber(inv.previous_bills_amount)}</td>
              </tr>
              <tr style="background: #f8fafc; font-weight: 800;">
                <td style="color: #0f2744;">3. قيمة الأعمال المنجزة خلال هذا المستخلص الحالي (Current Gross Amount):</td>
                <td style="text-align: center; color: #0f2744;">(1 - 2)</td>
                <td style="text-align: left; color: #0f2744; font-size: 10.5pt;">${App.formatNumber(inv.current_gross_amount)}</td>
              </tr>
              <tr>
                <td>4. يُخصم: استهلاك الدفعة المقدمة (Advance Payment Amortization):</td>
                <td style="text-align: center;">${inv.advance_pct || 10}%</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(inv.advance_deduction)}</td>
              </tr>
              <tr>
                <td>5. يُخصم: محتجزات ضمان حسن التنفيذ (Retention Guarantee Deduction):</td>
                <td style="text-align: center;">${inv.retention_pct || 10}%</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(inv.retention_deduction)}</td>
              </tr>
              ${inv.other_deductions > 0 ? `
              <tr>
                <td>6. يُخصم: استقطاعات وغرامات أو مواد موردة أخرى:</td>
                <td style="text-align: center;">مباشر</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(inv.other_deductions)}</td>
              </tr>` : ''}
              <tr style="background: #ecfdf5; font-weight: 900; font-size: 11pt; border-top: 2px solid #059669; border-bottom: 2px solid #059669;">
                <td style="color: #065f46; padding: 10px;">صافي المبلغ المعتمد والمستحق للصرف للمقاول (Net Payable to Contractor):</td>
                <td style="text-align: center; color: #047857;">صافي مستحق</td>
                <td style="text-align: left; color: #047857; font-size: 12pt; padding: 10px;">${App.formatNumber(inv.net_amount)} ${curr}</td>
              </tr>
            </tbody>
          </table>

          <!-- صندوق التفقيط المالي الرسمي -->
          <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 4px; padding: 10px 14px; margin-bottom: 16px; font-size: 8.5pt;">
            <span style="font-weight: bold; color: #475569;">المبلغ المستحق للصرف كتابةً بالحروف:</span>
            <span style="font-weight: 800; color: #0f2744; font-size: 9.5pt; margin-right: 8px;">${tafqeetText}</span>
          </div>

          ${inv.notes ? `
          <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 8pt; color: #92400e;">
            <strong>ملاحظات وشروط الاعتماد:</strong> ${inv.notes}
          </div>` : ''}

          <!-- التوقيعات الرباعية المعتمدة -->
          ${officialQuadrupleSignatures}
        </div>

        <!-- ملحق تفاصيل بنود جدول الكميات إن وجد -->
        ${itemsBreakdownHtml}

        ${footerHtml}
      </div>
    `;

    // حفظ نسخة المستخلص تلقائياً في الأرشيف الرقمي للمشروع
    this.saveReportToProjectFolder('مستخلص', `شهادة_مستخلص_${inv.invoice_no || 'IPC'}`, printArea.innerHTML, 'html', '04_المستخلصات_والفواتير');
    window.print();
  },

  printFinalSettlementDoc() {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;

    const { project, stats, settlement } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig('شهادة الحساب الختامي والمخالصة النهائية للمشروع', settlement?.settlement_no || 'SET-FINAL');
    const curr = project.currency || 'ر.ي';

    const origVal = stats.originalContractValue || 0;
    const changeVal = stats.totalApprovedChangeOrders || 0;
    const revVal = origVal + changeVal;
    const executedVal = settlement?.total_executed_work_val || revVal;
    const payments = settlement?.total_client_payments_received || (stats.totalInvoicesNet || 0);
    const retention = settlement?.released_retention_val || (origVal * 0.1);
    const penalties = settlement?.penalties_deductions_val || 0;
    const finalBalance = settlement?.final_balance_due !== undefined ? settlement.final_balance_due : Math.max(0, (executedVal - payments + retention - penalties));

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <div style="background: #fdfaf2; border: 1px solid #d4af37; border-radius: 6px; padding: 12px; text-align: center; margin-bottom: 16px;">
            <h3 style="color: #b8911c; margin: 0 0 4px 0;">مخالصة وتصفية ختامية نهائية للمشروع</h3>
            <p style="color: #64748b; font-size: 0.84rem; margin: 0;">كشف تصفية المستحقات المالية والأعمال المنفذة لمشروع (${project.name})</p>
          </div>

          <table class="official-report-table" style="margin-bottom: 16px;">
            <thead>
              <tr>
                <th>بيان الحساب الختامي والتصفية</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>قيمة العقد الأصلية المعتمدة:</td>
                <td style="text-align: left; font-weight: bold;">${App.formatNumber(origVal)}</td>
              </tr>
              <tr>
                <td>إجمالي أوامر التغيير والإضافيات المعتمدة (+):</td>
                <td style="text-align: left; color: #16a34a;">+${App.formatNumber(changeVal)}</td>
              </tr>
              <tr style="background: #f8fafc; font-weight: bold;">
                <td>القيمة التعاقدية المعدلة النهائية:</td>
                <td style="text-align: left; color: #0f2744;">${App.formatNumber(revVal)}</td>
              </tr>
              <tr>
                <td>إجمالي قيمة الأعمال المنفذة فعلياً والمسلمة:</td>
                <td style="text-align: left; font-weight: bold; color: #059669;">${App.formatNumber(executedVal)}</td>
              </tr>
              <tr>
                <td>يخصم: إجمالي الدفعات والمستخلصات المسددة من العميل (-):</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(payments)}</td>
              </tr>
              <tr>
                <td>يضاف: الإفراج عن محجوز ضمان الأعمال المتبقي (+):</td>
                <td style="text-align: left; color: #16a34a;">+${App.formatNumber(retention)}</td>
              </tr>
              <tr>
                <td>يخصم: الغرامات والاستقطاعات الجزائية (-):</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(penalties)}</td>
              </tr>
              <tr style="background: #fdfaf2; font-weight: 900; font-size: 1.15rem; border-top: 2px solid #d4af37;">
                <td style="color: #b8911c;">صافي الرصيد الختامي المستحق للمقاول:</td>
                <td style="text-align: left; color: #b8911c;">${App.formatNumber(finalBalance)} ${curr}</td>
              </tr>
            </tbody>
          </table>

          <div style="font-size: 0.84rem; line-height: 1.7; color: #475569; background: #f8fafc; padding: 12px; border-radius: 6px;">
            <strong>إبراء ذمة:</strong> يقر الطرفان بموجب هذا السند باستلام كافة الأعمال والمستحقات المذكورة وتعتبر هذه المخالصة نهائية ونافذة ومبرئة لذمة المقاول والمالك تماماً.
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ المخالصة الختامية تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('حساب ختامي', `مخالصة_وختامي_${settlement?.settlement_no || 'SET'}`, printArea.innerHTML, 'html', '09_الحساب_الختامي_والتصفية');
    window.print();
  },

  printQuotationDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const q = (this.data.quotations || []).find(item => item.id == id);
    if (!q) return;

    // إذا كان عرض السعر هو عرض السعر المتكامل الشامل (QT-2026-0001)، قم باستدعاء الطباعة المتكاملة طبق الأصل مباشرة
    if (q.quotation_no === 'QT-2026-0001') {
      this.selectedQuotationNo = q.quotation_no;
      this.printIntegratedQuotationOfficialDoc();
      return;
    }

    let items = [];
    if (q.items_json) {
      try {
        items = typeof q.items_json === 'string' ? JSON.parse(q.items_json) : q.items_json;
      } catch (e) {
        console.error('Error parsing quotation items:', e);
      }
    }

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`عرض سعر رسمي (${q.quotation_no})`, q.quotation_no);
    const curr = q.currency || 'ر.ي';

    const itemsRows = items.length > 0
      ? items.map((it, idx) => `
          <tr>
            <td style="text-align: center; font-weight: bold;">${it.item_no || (idx + 1)}</td>
            <td style="font-weight: 600;">${it.description || it.item || 'بند أعمال'}</td>
            <td style="text-align: center;">${it.unit || 'وحدة'}</td>
            <td style="text-align: center; font-weight: bold;">${it.quantity || it.qty || 1}</td>
            <td style="text-align: center; font-family: monospace;">${App.formatNumber(it.unit_price || it.rate || 0)}</td>
            <td style="text-align: left; font-weight: bold; font-family: monospace;">${App.formatNumber(it.total || (Number(it.quantity || it.qty || 1) * Number(it.unit_price || it.rate || 0)))}</td>
          </tr>
        `).join('')
      : `
          <tr>
            <td style="text-align: center;">1</td>
            <td>${q.title || 'تنفيذ أعمال المقاولات والتشطيبات طبقاً للمواصفات المعمارية والهندسية'}</td>
            <td style="text-align: center;">مقطوع</td>
            <td style="text-align: center;">1</td>
            <td style="text-align: center;">${App.formatNumber(q.total_amount)}</td>
            <td style="text-align: left; font-weight: bold;">${App.formatNumber(q.total_amount)}</td>
          </tr>
        `;

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">الموضوع / المشروع:</td>
              <td style="font-weight: 800; color: #0f2744;">${q.title}</td>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">العميل المقدم إليه:</td>
              <td>${q.client_name || project.client_name}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ العرض:</td>
              <td>${q.date}</td>
              <td style="font-weight: 800; background: #f1f5f9;">مدة الصلاحية:</td>
              <td>${q.valid_until || '30 يوماً من تاريخه'}</td>
            </tr>
          </table>

          <table class="official-report-table" style="margin-bottom: 16px;">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">م</th>
                <th>بيان الأعمال والمواصفات</th>
                <th style="width: 70px; text-align: center;">الوحدة</th>
                <th style="width: 65px; text-align: center;">الكمية</th>
                <th style="width: 100px; text-align: center;">سعر الوحدة</th>
                <th style="width: 110px; text-align: left;">الإجمالي (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
              <tr style="background: #f8fafc; font-weight: 900;">
                <td colspan="5" style="text-align: right; color: #0f2744;">إجمالي القيمة المقترحة:</td>
                <td style="text-align: left; color: #b8911c;">${App.formatNumber(q.total_amount)} ${curr}</td>
              </tr>
            </tbody>
          </table>

          <div style="background: #f8fafc; padding: 10px; border-radius: 4px; font-size: 0.84rem; color: #475569;">
            <div><strong>شروط الدفع:</strong> ${q.payment_terms || 'دفعات مرحلية حسب التقدم'}</div>
            <div><strong>مدة التنفيذ:</strong> ${q.delivery_period || 'حسب الاتفاق التعاقدي'}</div>
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ عرض السعر تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('عرض سعر', `عرض_سعر_${q.quotation_no || 'QUO'}`, printArea.innerHTML, 'html', 'تقارير_المشروع_المصدرة');
    window.print();
  },

  printChangeOrderSlip(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const c = (this.data.changeOrders || []).find(item => item.id == id);
    if (!c) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`أمر تغيير وإضافيات (${c.change_no})`, c.change_no);
    const curr = project.currency || 'ر.ي';

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800; color: #0f2744;">${project.name}</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">النوع:</td>
              <td>${c.type}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">عنوان أمر التغيير:</td>
              <td colspan="3" style="font-weight: bold; color: #0f2744;">${c.title}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الأثر المالي (+/-):</td>
              <td style="font-weight: 900; color: #b8911c;">+${App.formatNumber(c.amount)} ${curr}</td>
              <td style="font-weight: 800; background: #f1f5f9;">الأثر الزمني:</td>
              <td style="font-weight: bold;">+${c.time_extension_days || 0} يوماً تمديد</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">السبب والمبرر الهندسي:</td>
              <td colspan="3">${c.reason} - ${c.notes || ''}</td>
            </tr>
          </table>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ أمر التغيير تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('أمر تغيير', `أمر_تغيير_${c.change_no || 'CO'}`, printArea.innerHTML, 'html', 'تقارير_المشروع_المصدرة');
    window.print();
  },

  printDailyReportDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const r = (this.data.dailyReports || []).find(item => item.id == id);
    if (!r) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`تقرير الموقع اليومي (${r.report_no})`, r.report_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800;">${project.name}</td>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">تاريخ التقرير:</td>
              <td>${r.date}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">حالة الطقس:</td>
              <td>${r.weather}</td>
              <td style="font-weight: 800; background: #f1f5f9;">عدد العمالة:</td>
              <td>${r.manpower_count} عامل</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            تفاصيل الأعمال المنفذة في الموقع اليوم:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${r.work_performed}
          </div>

          <table class="official-report-table" style="margin-bottom: 14px;">
            <tr>
              <td style="font-weight: 800; width: 25%; background: #f1f5f9;">المعدات في الموقع:</td>
              <td>${r.equipment_summary || 'معدات اعتيادية'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">المواد الموردة:</td>
              <td>${r.materials_received || 'لا توجد توريدات اليوم'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الأمن والسلامة:</td>
              <td>${r.safety_notes || 'التزام تام بإجراءات السلامة'}</td>
            </tr>
          </table>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ التقرير اليومي تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('تقرير يومي', `تقرير_يومي_${r.report_no || r.date}`, printArea.innerHTML, 'html', '05_التقارير_الميدانية_اليومية_والأسبوعية');
    window.print();
  },

  printWeeklyReportDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const w = (this.data.weeklyReports || []).find(item => item.id == id);
    if (!w) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`تقرير الإنجاز الأسبوعي (${w.report_no})`, w.report_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800;">${project.name}</td>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">الأسبوع:</td>
              <td>الأسبوع ${w.week_no} (من ${w.date_from} إلى ${w.date_to})</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">نسبة الإنجاز المخطط:</td>
              <td><strong>${w.planned_progress_pct}%</strong></td>
              <td style="font-weight: 800; background: #f1f5f9;">نسبة الإنجاز الفعلي:</td>
              <td style="font-weight: bold; color: #059669;">${w.actual_progress_pct}%</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            ملخص الأعمال المنجزة خلال الأسبوع:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${w.achievements_summary}
          </div>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #2563eb; padding-right: 6px;">
            خطة العمل للأسبوع القادم:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${w.next_week_plan || 'متابعة الأعمال حسب الجدول الزمني.'}
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ التقرير الأسبوعي تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('تقرير أسبوعي', `تقرير_أسبوعي_${w.report_no || ('W' + w.week_no)}`, printArea.innerHTML, 'html', '05_التقارير_الميدانية_اليومية_والأسبوعية');
    window.print();
  },

  printHandoverDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const h = (this.data.handovers || []).find(item => item.id == id);
    if (!h) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`محضر استلام وفحص أعمال (${h.minute_no})`, h.minute_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800;">${project.name}</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">نوع الاستلام:</td>
              <td style="font-weight: bold; color: #0f2744;">${h.type}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الموقع / المحور:</td>
              <td>${h.location_axis || 'كامل الموقع'}</td>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ الفحص:</td>
              <td>${h.inspection_date}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">المهندس الاستشاري:</td>
              <td>${h.inspector_name}</td>
              <td style="font-weight: 800; background: #f1f5f9;">ممثل المقاول:</td>
              <td>${h.contractor_rep || 'م. المشروع'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">نتيجة الفحص:</td>
              <td colspan="3" style="font-weight: 900; color: #059669;">${h.status}</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            قائمة الملاحظات والنواقص (Punch List):
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${h.punch_list || 'لا توجد ملاحظات، تم الاستلام بنجاح.'}
          </div>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #059669; padding-right: 6px;">
            التوصيات الفنية:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7;">
            ${h.recommendations || 'التصريح بالمتابعة واستكمال المرحلة التالية.'}
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ محضر الاستلام تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('محضر استلام', `محضر_استلام_${h.minute_no || 'HND'}`, printArea.innerHTML, 'html', '08_محاضر_الاستلام_والمراسلات');
    window.print();
  },

  printCorrespondenceDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const c = (this.data.correspondence || []).find(item => item.id == id);
    if (!c) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`خطاب مراسلة رسمي (${c.ref_no})`, c.ref_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">المشروع:</td>
              <td>${project.name}</td>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">التاريخ:</td>
              <td>${c.date}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">من (المرسل):</td>
              <td>${c.sender}</td>
              <td style="font-weight: 800; background: #f1f5f9;">إلى (المستلم):</td>
              <td>${c.recipient}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الموضوع:</td>
              <td colspan="3" style="font-weight: bold; color: #0f2744;">${c.subject}</td>
            </tr>
          </table>

          <div style="font-size: 0.9rem; line-height: 1.8; color: #334155; background: #f8fafc; padding: 18px; border-radius: 6px; margin-bottom: 14px; min-height: 140px;">
            ${c.summary_body}
          </div>

          <div style="font-size: 0.82rem; color: #64748b;">
            <div><strong>الإجراء المطلوب:</strong> ${c.required_action || 'للعلم والإحاطة'}</div>
            ${c.attachment_name ? `<div><strong>المرفقات:</strong> ${c.attachment_name}</div>` : ''}
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    // حفظ المراسلة تلقائياً في مجلد المشروع
    this.saveReportToProjectFolder('مراسلة', `خطاب_${c.ref_no || 'COR'}`, printArea.innerHTML, 'html', '08_محاضر_الاستلام_والمراسلات');
    window.print();
  },

  // =========================================================================
  // خدمات إدارة وأرشفة مجلد المشروع على القرص وحفظ التقارير
  // =========================================================================

  /**
   * مزامنة وتأكيد وجود مجلد المشروع على جهاز ويندوز وجلب مساره الكامل
   */
  async syncProjectFolder(refreshTable = true) {
    if (!this.currentProjectId) return;
    try {
      const res = await fetch(`/api/project-files/${this.currentProjectId}/folder`);
      const json = await res.json();
      if (json.success && json.data) {
        this.folderInfo = json.data;
        const pathEl = document.getElementById('hubProjectFolderPath');
        const currentPathEl = document.getElementById('hubFilesCurrentPath');
        if (pathEl) pathEl.innerText = json.data.folderPath;
        if (currentPathEl) currentPathEl.innerText = json.data.folderPath;
        this.setCountBadge('cnt_project_files', json.data.filesCount || 0);

        if (refreshTable && this.activeTab === 'project-files') {
          this.renderProjectFiles();
        }
      }
    } catch (err) {
      console.warn('Sync project folder warning:', err);
    }
  },

  /**
   * فتح مجلد المشروع مباشرة في مستكشف ويندوز (Windows Explorer)
   */
  async openProjectFolderInExplorer() {
    if (!this.currentProjectId) return;
    try {
      App.showToast('جاري فتح مجلد المشروع في نظام ويندوز...', 'info');
      const res = await fetch(`/api/project-files/${this.currentProjectId}/open-folder`, {
        method: 'POST'
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم فتح المجلد في ويندوز بنجاح', 'success');
      } else {
        App.showToast(json.message || 'تعذر فتح المجلد', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في الاتصال أثناء فتح المجلد', 'error');
    }
  },

  /**
   * نسخ مسار المجلد الكامل إلى الحافظة
   */
  async copyProjectFolderPath() {
    const path = this.folderInfo?.folderPath || 
                 document.getElementById('hubFilesCurrentPath')?.innerText || 
                 document.getElementById('hubProjectFolderPath')?.innerText;
    if (!path || path.includes('جاري') || path === '-') {
      App.showToast('مسار المجلد غير جاهز بعد', 'warning');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(path);
      } else {
        const tempInput = document.createElement('input');
        tempInput.value = path;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }
      App.showToast('📋 تم نسخ مسار المجلد إلى الحافظة بنجاح!', 'success');
    } catch (e) {
      App.showToast('تعذر نسخ المسار تلقائياً', 'warning');
    }
  },

  /**
   * فتح ملف محدد عبر تطبيقه الافتراضي في ويندوز
   */
  async openFileInSystem(filePath) {
    if (!filePath) return;
    try {
      App.showToast('جاري فتح الملف...', 'info');
      const res = await fetch('/api/project-files/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم فتح الملف بنجاح', 'success');
      } else {
        App.showToast(json.message || 'تعذر فتح الملف', 'error');
      }
    } catch (e) {
      App.showToast('خطأ أثناء طلب فتح الملف', 'error');
    }
  },

  /**
   * تحديث واستعراض الملفات داخل مجلد المشروع
   */
  async refreshProjectFiles() {
    if (!this.currentProjectId) return;
    await this.syncProjectFolder(true);
    this.renderProjectFiles();
  },

  // رفع تقرير ممسوح ضوئياً وحفظه في أرشيف المشروع رقم 15.
  async archiveScannedReport() {
    if (!this.currentProjectId) return App.showToast('اختر مشروعاً أولاً', 'warning');
    const input = document.getElementById('scanArchiveFile');
    const file = input?.files?.[0];
    if (!file) return App.showToast('اختر ملف PDF أو صورة ممسوحة أولاً', 'warning');
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) return App.showToast('الصيغ المدعومة: PDF، JPG، PNG، WEBP', 'error');
    if (file.size > 25 * 1024 * 1024) return App.showToast('الحد الأعلى لحجم الملف 25MB', 'error');
    try {
      App.showToast('جاري رفع وأرشفة التقرير الممسوح...', 'info');
      const contentBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const res = await fetch(`/api/project-files/${this.currentProjectId}/scan-archive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, contentBase64, reportTitle: document.getElementById('scanArchiveTitle')?.value || '', category: document.getElementById('scanArchiveCategory')?.value || 'تقرير ممسوح' })
      });
      const json = await res.json().catch(() => ({ success: false, message: `تعذر استلام رد من الخادم (رمز ${res.status})` }));
      if (!json.success) return App.showToast(json.message || 'تعذر حفظ التقرير', 'error');
      App.showToast(json.message, 'success');
      input.value = ''; const title = document.getElementById('scanArchiveTitle'); if (title) title.value = '';
      await this.refreshProjectFiles();
    } catch (err) { App.showToast('حدث خطأ أثناء رفع الملف الممسوح', 'error'); }
  },

  /**
   * استعراض جدول ملفات المشروع
   */
  renderProjectFiles() {
    const tbody = document.getElementById('hubProjectFilesTableBody');
    if (!tbody) return;

    const files = this.folderInfo?.files || [];
    if (files.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">📂</div>
            <div style="font-weight: bold; color: #fff; margin-bottom: 4px; font-size: 1.05rem;">مجلد المشروع جاهز على جهازك ولكنه فارغ حالياً</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">كافة التقارير والعقود والمستخلصات التي تطبعها أو تصدرها يتم حفظها وتوثيقها تلقائياً هنا!</div>
            <div style="margin-top: 15px;">
              <button type="button" class="btn btn-primary btn-sm" onclick="ProjectHub.exportAndSaveProjectSummary()">
                💾 حفظ التقرير الشامل للمشروع الآن في مجلده
              </button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = files.map(f => {
      let icon = '📄';
      if (f.ext === '.html') icon = '🌐';
      else if (f.ext === '.xls' || f.ext === '.xlsx') icon = '📊';
      else if (f.ext === '.pdf') icon = '📕';
      else if (f.ext === '.dwg' || f.ext === '.dxf') icon = '📐';
      else if (f.ext === '.doc' || f.ext === '.docx') icon = '📝';
      else if (f.ext === '.jpg' || f.ext === '.png') icon = '🖼️';

      const modDate = new Date(f.modifiedAt).toLocaleString('ar-YE', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const safePath = f.fullPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.25rem;">${icon}</span>
              <div>
                <strong style="color: #fff; cursor: pointer;" onclick="ProjectHub.openFileInSystem('${safePath}')" title="انقر لفتح الملف">${f.name}</strong>
                <div style="font-size: 0.72rem; color: var(--text-secondary); direction: ltr; text-align: right;">${f.relativePath}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="badge" style="background: rgba(212,175,55,0.15); color: var(--gold-light); font-size: 0.78rem;">
              ${f.subfolder}
            </span>
          </td>
          <td style="font-weight: 600; color: #cbd5e1;">${f.sizeFormatted}</td>
          <td style="font-size: 0.82rem; color: var(--text-secondary);">${modDate}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="ProjectHub.openFileInSystem('${safePath}')" title="فتح الملف بتطبيقه الافتراضي في ويندوز">
                فتح ↗️
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.open('/api/project-files/download?path=' + encodeURIComponent('${safePath}'), '_blank')" title="استعراض أو تحميل الملف">
                👁️
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${safePath}'); App.showToast('تم نسخ مسار الملف بنجاح', 'success')" title="نسخ مسار الملف">
                📋
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  /**
   * حفظ تقرير أو مستند داخل مجلد المشروع المحدد على القرص
   */
  async saveReportToProjectFolder(reportType, reportName, content, format = 'html', targetSubfolder = null) {
    if (!this.currentProjectId || !content) return null;
    try {
      const res = await fetch(`/api/project-files/${this.currentProjectId}/save-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType,
          reportName,
          content,
          format,
          targetSubfolder
        })
      });
      const json = await res.json();
      if (json.success && json.data) {
        console.log(`✓ تم حفظ التقرير في مجلد المشروع: ${json.data.filePath}`);
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(`تم حفظ نسخة من التقرير في مجلد المشروع:\n${json.data.fileName}`, 'success');
        }
        this.syncProjectFolder(false);
        return json.data;
      }
    } catch (e) {
      console.warn('Could not auto-save report to project folder:', e);
    }
    return null;
  },

  /**
   * تصدير وحفظ التقرير الشامل للمشروع في مجلده الخاص
   */
  async exportAndSaveProjectSummary() {
    if (!this.data) return;
    const { project, stats, contract, invoices, changeOrders } = this.data;
    const curr = project.currency || 'ر.ي';

    App.showToast('جاري إعداد التقرير الشامل وحفظه في مجلد المشروع...', 'info');

    const htmlContent = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>تقرير مشروع - ${project.name}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; padding: 25px; background: #fff; color: #1e293b; line-height: 1.6; }
    .header { border-bottom: 3px double #d4af37; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    h1 { color: #0f2744; margin: 0 0 5px 0; font-size: 24px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 25px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .kpi-val { font-size: 18px; font-weight: bold; color: #0f2744; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 14px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: right; }
    th { background: #0f2744; color: #fff; }
    tr:nth-child(even) { background: #f8fafc; }
    .section-title { font-size: 18px; color: #0f2744; border-right: 4px solid #d4af37; padding-right: 10px; margin: 25px 0 10px 0; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>شركة رواسي عدن للهندسة والمقاولات</h1>
      <div style="font-size: 16px; font-weight: bold; color: #b8911c;">تقرير المتابعة الشامل للمشروع</div>
      <div>المشروع: <strong>${project.name}</strong> (${project.code || 'PRJ'}) | العميل: <strong>${project.client_name || 'عميل مباشر'}</strong></div>
    </div>
    <div style="text-align: left; font-size: 13px; color: #64748b;">
      <div>تاريخ إصدار التقرير: ${new Date().toLocaleDateString('ar-YE')}</div>
      <div>حالة المشروع: ${project.status === 'completed' ? 'مكتمل' : 'قيد التنفيذ'}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div style="font-size: 12px; color: #64748b;">قيمة العقد الأصلية</div>
      <div class="kpi-val">${App.formatNumber(stats.originalContractValue)} ${curr}</div>
    </div>
    <div class="kpi-card">
      <div style="font-size: 12px; color: #64748b;">أوامر التغيير المعتمدة</div>
      <div class="kpi-val" style="color: #b8911c;">+${App.formatNumber(stats.totalApprovedChangeOrders)} ${curr}</div>
    </div>
    <div class="kpi-card">
      <div style="font-size: 12px; color: #64748b;">المستخلصات المعتمدة الصافية</div>
      <div class="kpi-val" style="color: #059669;">${App.formatNumber(stats.totalInvoicesNet)} ${curr}</div>
    </div>
    <div class="kpi-card">
      <div style="font-size: 12px; color: #64748b;">نسبة الإنجاز الفعلية</div>
      <div class="kpi-val" style="color: #2563eb;">${project.progress_percentage || 0}%</div>
    </div>
  </div>

  <div class="section-title">بيانات العقد ونطاق العمل</div>
  <table>
    <tr>
      <th style="width: 20%;">رقم العقد</th>
      <td>${contract ? contract.contract_no : 'غير مسجل'}</td>
      <th style="width: 20%;">تاريخ التوقيع</th>
      <td>${contract ? contract.contract_date : '-'}</td>
    </tr>
    <tr>
      <th>الطرف الأول</th>
      <td>${contract ? contract.first_party : (project.client_name || '-')}</td>
      <th>الطرف الثاني</th>
      <td>${contract ? contract.second_party : 'شركة رواسي عدن'}</td>
    </tr>
    <tr>
      <th>مدة التنفيذ</th>
      <td>${contract ? contract.duration_days : '-'} يوماً</td>
      <th>فترة العقد</th>
      <td>من ${project.start_date || '-'} إلى ${project.end_date || '-'}</td>
    </tr>
  </table>

  <div class="section-title">سجل المستخلصات المالية المعتمدة (${invoices?.length || 0})</div>
  <table>
    <thead>
      <tr>
        <th>رقم المستخلص</th>
        <th>الفترة</th>
        <th>إجمالي الأعمال المنفذة</th>
        <th>الاستقطاعات</th>
        <th>صافي المستحق</th>
        <th>حالة الصرف</th>
      </tr>
    </thead>
    <tbody>
      ${(invoices && invoices.length > 0) ? invoices.map(i => `
        <tr>
          <td>${i.invoice_no}</td>
          <td>من ${i.period_from} إلى ${i.period_to}</td>
          <td>${App.formatNumber(i.gross_amount)} ${curr}</td>
          <td>-${App.formatNumber((i.advance_deduction || 0) + (i.retention_deduction || 0) + (i.other_deductions || 0))} ${curr}</td>
          <td style="font-weight: bold; color: #059669;">${App.formatNumber(i.net_amount)} ${curr}</td>
          <td>${i.status}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" style="text-align: center;">لا توجد مستخلصات مسجلة</td></tr>'}
    </tbody>
  </table>

  <div class="section-title">أوامر التغيير والإضافيات (${changeOrders?.length || 0})</div>
  <table>
    <thead>
      <tr>
        <th>رقم الأمر</th>
        <th>البيان</th>
        <th>الأثر المالي</th>
        <th>تمديد المدة</th>
        <th>الحالة</th>
      </tr>
    </thead>
    <tbody>
      ${(changeOrders && changeOrders.length > 0) ? changeOrders.map(c => `
        <tr>
          <td>${c.change_no}</td>
          <td>${c.title}</td>
          <td>+${App.formatNumber(c.amount)} ${curr}</td>
          <td>+${c.time_extension_days || 0} يوم</td>
          <td>${c.status}</td>
        </tr>
      `).join('') : '<tr><td colspan="5" style="text-align: center;">لا توجد أوامر تغيير مسجلة</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    تم استخراج هذا التقرير آلياً بواسطة نظام رواسي عدن للهندسة والمقاولات - ملفات ومستندات المشروع الرسمية
  </div>
</body>
</html>
    `;

    const saved = await this.saveReportToProjectFolder(
      'تقرير شامل',
      `التقرير_الشامل_${project.name}`,
      htmlContent,
      'html',
      'تقارير_المشروع_المصدرة'
    );

    if (saved) {
      await this.refreshProjectFiles();
      if (confirm(`تم حفظ التقرير الشامل بنجاح في مجلد المشروع:\n${saved.filePath}\n\nهل تود فتح المجلد الآن في نظام ويندوز؟`)) {
        this.openProjectFolderInExplorer();
      }
    }
  },

  // =================== إدارة وتخصيص مسار مجلد المشاريع في ويندوز ===================

  defaultBaseFolder: null,
  currentBaseFolder: null,

  /**
   * فتح نافذة ضبط مسار مجلد حفظ ملفات المشاريع
   */
  async openBaseFolderModal() {
    try {
      App.openModal('baseFolderSettingsModal');
      const displayEl = document.getElementById('baseFolderCurrentPathDisplay');
      const inputEl = document.getElementById('baseFolderPathInput');
      const badgeEl = document.getElementById('baseFolderStatusBadge');

      if (displayEl) displayEl.innerText = 'جاري التحقق من مسار المجلد الحالي...';

      const res = await fetch('/api/project-files/settings/base-folder');
      const json = await res.json();
      if (json.success && json.data) {
        this.currentBaseFolder = json.data.currentPath;
        this.defaultBaseFolder = json.data.defaultPath;

        if (displayEl) displayEl.innerText = json.data.currentPath;
        if (inputEl) inputEl.value = json.data.currentPath;
        if (badgeEl) {
          if (json.data.isCustom) {
            badgeEl.className = 'drawing-badge-status under-review';
            badgeEl.innerText = 'مسار مخصص يدوي';
          } else {
            badgeEl.className = 'drawing-badge-status approved';
            badgeEl.innerText = 'المسار الافتراضي للنظام';
          }
        }
      }
    } catch (err) {
      console.error('Error loading base folder settings:', err);
      App.showToast('تعذر جلب إعدادات مسار المجلد', 'error');
    }
  },

  /**
   * تعيين مسار سريع في حقل الإدخال
   */
  setQuickPath(pathStr) {
    const inputEl = document.getElementById('baseFolderPathInput');
    if (inputEl && pathStr) {
      inputEl.value = pathStr;
      inputEl.focus();
    }
  },

  /**
   * لصق المسار من الحافظة مباشرة
   */
  async pasteBaseFolderFromClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          const inputEl = document.getElementById('baseFolderPathInput');
          if (inputEl) {
            inputEl.value = text.trim();
            App.showToast('تم لصق المسار من الحافظة بنجاح', 'success');
          }
          return;
        }
      }
      App.showToast('لم يتم العثور على نص داخل الحافظة', 'info');
    } catch (e) {
      App.showToast('يرجى لصق المسار يدوياً بالضغط على Ctrl+V داخل الحقل', 'info');
    }
  },

  /**
   * حفظ واعتماد مسار المجلد الجديد أو استعادة الافتراضي
   */
  async saveBaseFolder(reset = false) {
    try {
      let bodyData = {};
      if (reset) {
        if (!confirm('هل أنت متأكد من استعادة المسار الافتراضي لملفات المشاريع داخل مجلد البرنامج؟')) {
          return;
        }
        bodyData = { resetToDefault: true };
      } else {
        const inputEl = document.getElementById('baseFolderPathInput');
        const folderPath = inputEl ? inputEl.value.trim() : '';
        if (!folderPath) {
          App.showToast('يرجى كتابة أو لصق مسار المجلد', 'warning');
          return;
        }
        bodyData = { folderPath };
      }

      App.showToast('جاري حفظ واعتماد المسار...', 'info');
      const res = await fetch('/api/project-files/settings/base-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم تحديث مسار حفظ ملفات المشاريع بنجاح', 'success');
        App.closeModal('baseFolderSettingsModal');
        // تحديث مسار مجلد المشروع الحالي في الواجهة فوراً
        await this.syncProjectFolder(true);
        if (this.activeTab === 'project-files') {
          this.renderProjectFiles();
        }
      } else {
        App.showToast(json.message || 'تعذر اعتماد المسار المحدد', 'error');
      }
    } catch (err) {
      console.error('Save base folder error:', err);
      App.showToast('خطأ في الاتصال أثناء حفظ المسار', 'error');
    }
  },

  /**
   * فتح المجلد الأساسي لملفات المشاريع في مستكشف ويندوز
   */
  async openBaseFolderInWindows() {
    try {
      App.showToast('جاري فتح المجلد الأساسي للمشاريع في ويندوز...', 'info');
      const res = await fetch('/api/project-files/settings/open-base-folder', {
        method: 'POST'
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم فتح المجلد في ويندوز بنجاح', 'success');
      } else {
        App.showToast(json.message || 'تعذر فتح المجلد', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في الاتصال أثناء طلب فتح المجلد', 'error');
    }
  },

  // =========================================================================
  // 16. عرض السعر والتسعير المتكامل (المخازن والمواد والكميات والموردين)
  // =========================================================================
  integratedQuotationData: null,
  selectedQuotationNo: null,

  async loadIntegratedQuotation(forceRefresh = false) {
    if (!this.currentProjectId) {
      const select = document.getElementById('hubProjectSelect');
      if (select && select.value) {
        this.currentProjectId = Number(select.value);
      } else {
        this.currentProjectId = 1;
      }
    }
    if (this.integratedQuotationData && !forceRefresh) {
      return this.integratedQuotationData;
    }

    try {
      const qNo = this.selectedQuotationNo ? `?quotation_no=${encodeURIComponent(this.selectedQuotationNo)}` : '';
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/integrated-quotation${qNo}`);
      const json = await res.json().catch(() => ({ success: false, message: 'فشل في الاتصال' }));
      if (json.success && json.data) {
        this.integratedQuotationData = json.data;
        this.selectedQuotationNo = json.data.quotation?.quotation_no || null;
        this.setCountBadge('cnt_integrated_quotation', json.data.items?.length || 0);
        return this.integratedQuotationData;
      }
    } catch (e) {
      console.error('Error loading integrated quotation:', e);
    }
    return null;
  },

  async switchIntegratedQuotation(quoNo) {
    if (!quoNo) return;
    this.selectedQuotationNo = quoNo;
    await this.renderIntegratedQuotation();
  },

  async renderIntegratedQuotation() {
    const pane = document.getElementById('hubPane_integrated-quotation');
    if (pane) pane.style.display = 'block';

    const tbody = document.getElementById('hubIntegratedQuotationTableBody');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align:center; padding: 25px; color: var(--text-secondary);">
          جاري تحميل عرض السعر المتكامل وربط المخازن والموردين...
        </td>
      </tr>
    `;

    const data = await this.loadIntegratedQuotation(true);
    if (!data || !data.items || data.items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center; padding: 30px; color: var(--text-secondary);">
            لا توجد بنود مسجلة في عرض السعر الحالي. اضغط على "+ إضافة بند" أو "استيراد من BOQ".
          </td>
        </tr>
      `;
      return;
    }

    const { project, quotation, items, summary } = data;
    const curr = quotation?.currency || '$';

    // تحديث قائمة اختيار عروض الأسعار
    const quoSelect = document.getElementById('intQuoSelect');
    if (quoSelect) {
      if (data.allQuotations && data.allQuotations.length > 0) {
        quoSelect.innerHTML = data.allQuotations.map(q => {
          const isSel = (q.quotation_no === (quotation?.quotation_no || this.selectedQuotationNo));
          const isCurrent = (q.project_id == this.currentProjectId);
          return `<option value="${q.quotation_no}" ${isSel ? 'selected' : ''}>
            ${isCurrent ? '⭐ [لهذا المشروع] ' : ''}${q.quotation_no} - ${q.project_name || q.title} (${App.formatNumber(q.total_amount)} ${q.currency || '$'})
          </option>`;
        }).join('');
      } else {
        quoSelect.innerHTML = `<option value="${quotation?.quotation_no || ''}">${quotation?.quotation_no || 'عرض سعر جديد'} - ${project?.name || ''}</option>`;
      }
    }

    // تحديث البطاقات العلوية
    const badgeNo = document.getElementById('intQuoBadgeNo');
    if (badgeNo) badgeNo.innerText = quotation?.quotation_no || 'QT-2026-0001';

    const contractOwner = project?.contract_owner || project?.client_name || 'العميل المعتمد';
    const projName = project?.name || 'مشروع هندسي';

    // تحديث عناوين وشارات رأس التبويب 16
    const headerProjName = document.getElementById('intQuoHeaderProjName');
    if (headerProjName) headerProjName.innerText = projName;

    const boqLinkBadge = document.getElementById('intQuoBoqLinkBadge');
    if (boqLinkBadge) boqLinkBadge.innerText = `🔗 مربوط بالمخازن و BOQ والموردين (${items.length} بند)`;

    const subtitleEl = document.getElementById('intQuoSubtitle');
    if (subtitleEl) subtitleEl.innerText = `ربط متكامل لـ ${items.length} بند بين الكميات التعاقدية (BOQ)، المواد المخزنية، وأرصدة وأسعار الموردين المعتمدين مع إمكانية الطباعة طبق الأصل للمستند الورقي.`;

    const clientName = document.getElementById('intQuoClientName');
    if (clientName) clientName.innerText = contractOwner;

    const clientPhone = document.getElementById('intQuoClientPhone');
    if (clientPhone) clientPhone.innerText = project?.client_phone || 'غير مسجل';

    const projNameEl = document.getElementById('intQuoProjectName');
    if (projNameEl) projNameEl.innerText = projName;

    const projCode = document.getElementById('intQuoProjectCode');
    if (projCode) projCode.innerText = project?.code || 'PRJ';

    const dateRange = document.getElementById('intQuoDateRange');
    if (dateRange) dateRange.innerText = `${quotation?.date || '12-09-2026'} إلى ${quotation?.valid_until || 'حسب الاتفاق'}`;

    const currEl = document.getElementById('intQuoCurrency');
    if (currEl) {
      const currName = curr === 'ر.ي' ? 'ريال يمني' : (curr === '$' ? 'دولار أمريكي' : (curr === 'ر.س' ? 'ريال سعودي' : curr));
      currEl.innerText = `${curr} (${currName})`;
    }

    const totalEl = document.getElementById('intQuoTotalDisplay');
    if (totalEl) totalEl.innerText = `${App.formatNumber(summary.totalAmount)} ${curr}`;

    const footerTotal = document.getElementById('intQuoFooterTotal');
    if (footerTotal) footerTotal.innerText = `${App.formatNumber(summary.totalAmount)} ${curr}`;

    const footerNotes = document.getElementById('intQuoFooterNotes');
    if (footerNotes) footerNotes.innerText = `ملاحظة: ${summary.notes || quotation?.notes || 'عرض سعر رسمي معتمد'}`;

    const amountWords = document.getElementById('intQuoAmountWords');
    if (amountWords) {
      const words = summary.amountWords || ((typeof Accounting !== 'undefined' && Accounting.tafqeet) ? Accounting.tafqeet(summary.totalAmount, curr) : `${App.formatNumber(summary.totalAmount)} ${curr}`);
      amountWords.innerText = words;
    }

    // تعبئة الجدول الرئيسي
    tbody.innerHTML = items.map((it, idx) => {
      let stockBadgeColor = '#10b981';
      let stockBadgeBg = 'rgba(16, 185, 129, 0.15)';
      if (it.stock_status && it.stock_status.includes('🔴')) {
        stockBadgeColor = '#ef4444';
        stockBadgeBg = 'rgba(239, 68, 68, 0.15)';
      } else if (it.stock_status && it.stock_status.includes('🟡')) {
        stockBadgeColor = '#f59e0b';
        stockBadgeBg = 'rgba(245, 158, 11, 0.15)';
      }

      return `
        <tr style="transition: background 0.15s ease;">
          <td style="text-align: center; font-weight: bold; color: var(--gold-light);">${it.item_no || (idx + 1)}</td>
          <td style="font-weight: 600; color: #f8fafc;">
            ${it.description}
            ${it.category ? `<span style="display:block; font-size:0.72rem; color:var(--text-secondary);">${it.category}</span>` : ''}
          </td>
          <td style="text-align: center;"><span class="badge" style="background: rgba(255,255,255,0.06);">${it.unit}</span></td>
          <td style="text-align: center; font-weight: bold;">${it.quantity}</td>
          <td style="text-align: center; font-family: monospace;">${App.formatNumber(it.unit_price)}</td>
          <td style="text-align: center; font-weight: bold; font-family: monospace; color: #34d399;">${App.formatNumber(it.total)}</td>
          <td style="text-align: center;">
            <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.74rem;">
              ${it.boq_item_no || 'BOQ'}
            </span>
          </td>
          <td>
            <div style="font-size: 0.8rem; color: #cbd5e1; font-weight: 500;">
              📦 ${it.material_name || it.description}
            </div>
            <div style="font-size: 0.72rem; color: var(--text-secondary);">
              الرصيد: <b style="color:#e2e8f0;">${it.stock_quantity || 0}</b> ${it.stock_unit || it.unit}
            </div>
          </td>
          <td style="text-align: center;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.74rem; font-weight: 600; background: ${stockBadgeBg}; color: ${stockBadgeColor}; border: 1px solid ${stockBadgeColor}40;">
              ${it.stock_status || 'متوفر بالمخزن 🟢'}
            </span>
          </td>
          <td>
            <div style="font-size: 0.8rem; color: #f1f5f9; font-weight: 500;">
              🏢 ${it.supplier_name || 'مورد معتمد'}
            </div>
            <div style="font-size: 0.74rem; color: var(--gold-light); font-family: monospace; margin-top: 1px;">
              📞 <a href="tel:${it.supplier_phone}" style="color: inherit; text-decoration: none;">${it.supplier_phone || '775566778'}</a>
            </div>
          </td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 4px; justify-content: center;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="ProjectHub.openEditQuotationItemModal(${idx})" title="تعديل هذا البند" style="padding: 3px 7px;">
                ✏️
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="ProjectHub.deleteQuotationItem(${idx})" title="حذف البند" style="padding: 3px 7px;">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  calcQuoItemTotal() {
    const qty = Number(document.getElementById('quoItemQty')?.value || 1);
    const price = Number(document.getElementById('quoItemPrice')?.value || 0);
    const totalEl = document.getElementById('quoItemTotal');
    if (totalEl) totalEl.value = (qty * price).toFixed(2);
  },

  populateQuoItemMaterialsAndSuppliers() {
    if (!this.integratedQuotationData) return;
    const { allMaterials, allSuppliers } = this.integratedQuotationData;

    const matSel = document.getElementById('quoItemMaterialSelect');
    if (matSel && allMaterials) {
      matSel.innerHTML = '<option value="">-- ربط بمادة جديدة / غير محدد --</option>' +
        allMaterials.map(m => `<option value="${m.id}" data-unit="${m.unit}" data-price="${m.unit_price}" data-qty="${m.current_quantity}" data-name="${m.name}">${m.name} (رصيد: ${m.current_quantity} ${m.unit})</option>`).join('');
    }

    const suppSel = document.getElementById('quoItemSupplierSelect');
    if (suppSel && allSuppliers) {
      suppSel.innerHTML = '<option value="">-- اختر من قائمة الموردين --</option>' +
        allSuppliers.map(s => `<option value="${s.id}" data-phone="${s.phone}" data-name="${s.name}">${s.name} (${s.phone || ''})</option>`).join('');
    }
  },

  onQuoItemMaterialChange(sel) {
    const opt = sel.options[sel.selectedIndex];
    const stockInfo = document.getElementById('quoItemStockInfo');
    if (opt && opt.value) {
      const qty = opt.getAttribute('data-qty');
      const unit = opt.getAttribute('data-unit');
      const price = opt.getAttribute('data-price');
      if (stockInfo) stockInfo.value = `${qty} ${unit}`;
      const priceInput = document.getElementById('quoItemPrice');
      if (priceInput && (!priceInput.value || priceInput.value == '0')) {
        priceInput.value = price;
        this.calcQuoItemTotal();
      }
      const unitInput = document.getElementById('quoItemUnit');
      if (unitInput && !unitInput.value) unitInput.value = unit;
    } else {
      if (stockInfo) stockInfo.value = 'غير محدد';
    }
  },

  onQuoItemSupplierChange(sel) {
    const opt = sel.options[sel.selectedIndex];
    const phoneInput = document.getElementById('quoItemSupplierPhone');
    if (opt && opt.value) {
      const phone = opt.getAttribute('data-phone');
      if (phoneInput) phoneInput.value = phone || '';
    }
  },

  openNewQuotationItemModal() {
    this.populateQuoItemMaterialsAndSuppliers();
    const nextNo = (this.integratedQuotationData?.items?.length || 0) + 1;

    document.getElementById('modalQuoItemTitle').innerText = '🏷️ إضافة بند جديد لعرض السعر';
    document.getElementById('quoItemIndex').value = '-1';
    document.getElementById('quoItemNo').value = nextNo;
    document.getElementById('quoItemBoqNo').value = `BOQ-${String(nextNo).padStart(2, '0')}`;
    document.getElementById('quoItemCategory').value = 'تشطيبات وتجهيزات';
    document.getElementById('quoItemDesc').value = '';
    document.getElementById('quoItemUnit').value = 'M2';
    document.getElementById('quoItemQty').value = '1';
    document.getElementById('quoItemPrice').value = '0';
    document.getElementById('quoItemTotal').value = '0';
    document.getElementById('quoItemStockInfo').value = '';
    document.getElementById('quoItemMaterialSelect').value = '';
    document.getElementById('quoItemSupplierSelect').value = '';
    document.getElementById('quoItemSupplierPhone').value = '';

    App.openModal('editQuotationItemModal');
  },

  openEditQuotationItemModal(idx) {
    if (!this.integratedQuotationData || !this.integratedQuotationData.items) return;
    const it = this.integratedQuotationData.items[idx];
    if (!it) return;

    this.populateQuoItemMaterialsAndSuppliers();

    document.getElementById('modalQuoItemTitle').innerText = `🏷️ تعديل البند رقم (${it.item_no || (idx + 1)})`;
    document.getElementById('quoItemIndex').value = idx;
    document.getElementById('quoItemNo').value = it.item_no || (idx + 1);
    document.getElementById('quoItemBoqNo').value = it.boq_item_no || `BOQ-${String(idx + 1).padStart(2, '0')}`;
    document.getElementById('quoItemCategory').value = it.category || '';
    document.getElementById('quoItemDesc').value = it.description || '';
    document.getElementById('quoItemUnit').value = it.unit || 'M2';
    document.getElementById('quoItemQty').value = it.quantity || 1;
    document.getElementById('quoItemPrice').value = it.unit_price || 0;
    document.getElementById('quoItemTotal').value = it.total || (Number(it.quantity || 1) * Number(it.unit_price || 0));

    const matSel = document.getElementById('quoItemMaterialSelect');
    if (matSel) {
      matSel.value = it.material_id || '';
      this.onQuoItemMaterialChange(matSel);
    }

    const suppSel = document.getElementById('quoItemSupplierSelect');
    if (suppSel) {
      suppSel.value = it.supplier_id || '';
      this.onQuoItemSupplierChange(suppSel);
    }
    const phoneInput = document.getElementById('quoItemSupplierPhone');
    if (phoneInput && it.supplier_phone) {
      phoneInput.value = it.supplier_phone;
    }

    App.openModal('editQuotationItemModal');
  },

  async submitQuotationItemForm(e) {
    if (e) e.preventDefault();
    if (!this.integratedQuotationData) return;

    const idx = parseInt(document.getElementById('quoItemIndex')?.value || '-1', 10);
    const itemNo = Number(document.getElementById('quoItemNo')?.value || 1);
    const boqNo = document.getElementById('quoItemBoqNo')?.value || `BOQ-${String(itemNo).padStart(2, '0')}`;
    const desc = document.getElementById('quoItemDesc')?.value.trim();
    const category = document.getElementById('quoItemCategory')?.value.trim() || 'تشطيبات وتجهيزات';
    const unit = document.getElementById('quoItemUnit')?.value.trim() || 'وحدة';
    const qty = Number(document.getElementById('quoItemQty')?.value || 1);
    const price = Number(document.getElementById('quoItemPrice')?.value || 0);
    const total = Number(document.getElementById('quoItemTotal')?.value || (qty * price));

    const matSel = document.getElementById('quoItemMaterialSelect');
    const matOpt = matSel?.options[matSel.selectedIndex];
    const materialId = matSel?.value || null;
    const materialName = (matOpt && matOpt.value) ? matOpt.getAttribute('data-name') : desc;
    const stockQty = (matOpt && matOpt.value) ? Number(matOpt.getAttribute('data-qty')) : 10;

    const suppSel = document.getElementById('quoItemSupplierSelect');
    const suppOpt = suppSel?.options[suppSel.selectedIndex];
    const supplierId = suppSel?.value || null;
    const supplierName = (suppOpt && suppOpt.value) ? suppOpt.getAttribute('data-name') : 'مورد معتمد';
    const supplierPhone = document.getElementById('quoItemSupplierPhone')?.value.trim() || '772332164';

    const itemObj = {
      item_no: itemNo,
      description: desc,
      unit: unit,
      quantity: qty,
      unit_price: price,
      total: total,
      category: category,
      boq_item_no: boqNo,
      material_id: materialId,
      material_name: materialName,
      stock_quantity: stockQty,
      stock_unit: unit,
      stock_status: stockQty <= 0 ? 'نفذ من المخزن 🔴' : (stockQty <= 5 ? 'مخزون منخفض 🟡' : 'متوفر بالمخزن 🟢'),
      supplier_id: supplierId,
      supplier_name: supplierName,
      supplier_phone: supplierPhone,
      boq_linked: true
    };

    if (idx >= 0 && idx < this.integratedQuotationData.items.length) {
      this.integratedQuotationData.items[idx] = itemObj;
    } else {
      this.integratedQuotationData.items.push(itemObj);
    }

    // إرسال التحديث إلى الخادم
    try {
      App.showToast('جاري حفظ البند وتحديث عرض السعر...', 'info');
      const quo = this.integratedQuotationData.quotation;
      const payload = {
        quotation_no: quo?.quotation_no || 'QT-2026-0001',
        title: quo?.title || `عرض سعر ${this.data?.project?.name || ''}`,
        date: quo?.date || new Date().toISOString().split('T')[0],
        valid_until: quo?.valid_until || null,
        currency: quo?.currency || this.data?.project?.currency || '$',
        notes: quo?.notes || 'الكهرباء حسب الكشف حق حمدي الكهربائي',
        items: this.integratedQuotationData.items
      };

      const res = await fetch(`/api/project-hub/${this.currentProjectId}/integrated-quotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم حفظ البند وتحديث الحسابات بنجاح 💾', 'success');
        App.closeModal('editQuotationItemModal');
        await this.renderIntegratedQuotation();
      } else {
        App.showToast(json.message || 'تعذر حفظ البند', 'error');
      }
    } catch (err) {
      console.error('Save item error:', err);
      App.showToast('خطأ في الاتصال بالخادم أثناء الحفظ', 'error');
    }
  },

  async deleteQuotationItem(idx) {
    if (!this.integratedQuotationData || !this.integratedQuotationData.items) return;
    const it = this.integratedQuotationData.items[idx];
    if (!confirm(`هل أنت متأكد من حذف البند (${it.description}) من عرض السعر؟`)) return;

    this.integratedQuotationData.items.splice(idx, 1);
    // إعادة ترقيم البنود
    this.integratedQuotationData.items.forEach((item, i) => {
      item.item_no = i + 1;
    });

    try {
      const quo = this.integratedQuotationData.quotation;
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/integrated-quotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotation_no: quo?.quotation_no || 'QT-2026-0001',
          items: this.integratedQuotationData.items
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم حذف البند وتحديث الإجمالي بنجاح', 'success');
        await this.renderIntegratedQuotation();
      }
    } catch (e) {
      App.showToast('خطأ في الاتصال أثناء حذف البند', 'error');
    }
  },

  async exportQuotationToBoq() {
    if (!this.integratedQuotationData || !this.integratedQuotationData.items) {
      await this.loadIntegratedQuotation(true);
    }
    const items = this.integratedQuotationData?.items || [];
    if (items.length === 0) {
      App.showToast('لا توجد بنود لتصديرها لجدول الكميات', 'warning');
      return;
    }

    try {
      App.showToast('جاري تصدير وتحديث جدول الكميات BOQ...', 'info');
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/integrated-quotation/export-boq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم التصدير لجدول الكميات BOQ بنجاح ✅', 'success');
        // تحديث عدادات المشروع
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'تعذر التصدير لجدول الكميات', 'error');
      }
    } catch (err) {
      console.error('Export boq error:', err);
      App.showToast('خطأ في الاتصال أثناء التصدير لـ BOQ', 'error');
    }
  },

  async importBoqToQuotation() {
    if (!confirm('هل تريد استيراد البنود من جدول الكميات BOQ واستبدال بنود عرض السعر الحالية؟')) return;
    try {
      App.showToast('جاري استيراد بنود BOQ...', 'info');
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/integrated-quotation/import-boq`, {
        method: 'POST'
      });
      const json = await res.json();
      if (json.success && json.items) {
        this.integratedQuotationData.items = json.items;
        App.showToast(json.message || 'تم الاستيراد بنجاح ✅', 'success');
        await this.renderIntegratedQuotation();
      } else {
        App.showToast(json.message || 'لا توجد بنود لاستيرادها', 'warning');
      }
    } catch (e) {
      App.showToast('خطأ في الاتصال أثناء الاستيراد من BOQ', 'error');
    }
  },

  checkAndReserveInventory() {
    if (!this.integratedQuotationData || !this.integratedQuotationData.items) return;
    const items = this.integratedQuotationData.items;

    let availableCount = 0;
    let lowCount = 0;
    let outCount = 0;

    items.forEach(it => {
      if (it.stock_status && it.stock_status.includes('🔴')) outCount++;
      else if (it.stock_status && it.stock_status.includes('🟡')) lowCount++;
      else availableCount++;
    });

    alert(
      `📊 نتيجة الفحص الميداني لمخازن ومواد عرض السعر:\n` +
      `--------------------------------------------------\n` +
      `• إجمالي البنود: ${items.length} بند\n` +
      `• المواد المتوفرة بالكامل بالمخزن 🟢: ${availableCount} بند\n` +
      `• المواد بمستوى رصيد منخفض 🟡: ${lowCount} بند\n` +
      `• المواد المنتهية / يلزم طلب شراء 🔴: ${outCount} بند\n\n` +
      `جميع المواد تم ربطها تلقائياً بالموردين المعتمدين مع أرقام الاتصال لسرعة التوريد.`
    );
  },

  /**
   * طباعة عرض السعر الرسمي طبق الأصل (صفحتين A4 متطابقتين مع نموذج العرض المعتمد)
   */
  async printIntegratedQuotationOfficialDoc() {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    if (!this.integratedQuotationData || !this.integratedQuotationData.items) {
      await this.loadIntegratedQuotation(true);
    }

    const data = this.integratedQuotationData;
    if (!data || !data.items || data.items.length === 0) {
      App.showToast('لا توجد بنود لطباعة عرض السعر', 'warning');
      return;
    }

    const { project, quotation, items, summary } = data;
    const curr = quotation?.currency || project?.currency || 'ر.ي';
    const quoNo = quotation?.quotation_no || 'QT-2026-0001';
    const quoDate = quotation?.date || new Date().toISOString().split('T')[0];
    const validUntil = quotation?.valid_until || 'حسب الاتفاق';
    const contractOwner = project?.contract_owner || project?.client_name || 'العميل المعتمد';
    const clientPhone = project?.client_phone || 'غير مسجل';
    const projName = project?.name || 'مشروع هندسي';
    const notes = summary?.notes || quotation?.notes || 'عرض سعر رسمي معتمد';

    const grandTotal = items.reduce((acc, it) => acc + Number(it.total || 0), 0);
    const tafqeetWords = summary?.amountWords || ((typeof Accounting !== 'undefined' && Accounting.tafqeet) ? Accounting.tafqeet(grandTotal, curr) : `${App.formatNumber(grandTotal)} ${curr}`);

    const isSinglePage = (items.length <= 16);
    let pagesHtml = '';

    if (isSinglePage) {
      pagesHtml = `
        <div class="quo-print-page">
          <div>
            <!-- رأس الصفحة والهوية -->
            <div class="quo-header-box">
              <div class="quo-company-row">
                <div>
                  <h2 style="margin: 0; color: #0f2744; font-size: 1.15rem; font-weight: 800;">شركة رواسي عدن للهندسة والمقاولات</h2>
                  <div style="font-size: 0.72rem; color: #475569; font-weight: 600;">Rawasi Aden for Engineering & Contracting</div>
                </div>
                <div style="text-align: left; font-size: 0.72rem; color: #475569; line-height: 1.3;">
                  <div>عدن - الجمهورية اليمنية</div>
                  <div>هاتف: 773413937 - 772332164</div>
                  <div>س.ت: 102948 | ر.ض: 3004918</div>
                </div>
              </div>

              <!-- شريط العنوان الرئيسي -->
              <div class="quo-title-badge">
                عـرض سـعـر وتـسـعـيـر مـتـكـامـل — QUOTATION OFFER
              </div>

              <!-- تفاصيل المستند والعميل -->
              <div class="quo-meta-grid">
                <div class="quo-meta-item">
                  <span class="quo-meta-label">السادة:</span>
                  <span style="font-weight: 700; color: #0f2744;">${contractOwner}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">رقم العرض:</span>
                  <span style="font-family: monospace; font-weight: 800; color: #0f2744;">${quoNo}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">التاريخ:</span>
                  <span>${quoDate}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">المشروع:</span>
                  <span style="font-weight: 700;">${projName}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">هاتف العميل:</span>
                  <span style="font-family: monospace;">${clientPhone}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">صالح حتى:</span>
                  <span>${validUntil}</span>
                </div>
              </div>
            </div>

            <!-- جدول البنود -->
            <table class="quo-official-table">
              <thead>
                <tr>
                  <th style="width: 32px;">م</th>
                  <th>وصف وبيان البند</th>
                  <th style="width: 60px;">الوحدة</th>
                  <th style="width: 55px;">الكمية</th>
                  <th style="width: 90px;">سعر الوحدة (${curr})</th>
                  <th style="width: 95px;">الإجمالي (${curr})</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(it => `
                  <tr>
                    <td style="text-align: center; font-weight: bold;">${it.item_no}</td>
                    <td style="font-weight: 600;">${it.description || 'بند أعمال'}</td>
                    <td style="text-align: center;">${it.unit || 'وحدة'}</td>
                    <td style="text-align: center; font-weight: bold;">${it.quantity}</td>
                    <td style="text-align: center; font-family: monospace;">${App.formatNumber(it.unit_price)}</td>
                    <td style="text-align: center; font-weight: bold; font-family: monospace;">${App.formatNumber(it.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <!-- صندوق الإجماليات والملاحظات والمبلغ كتابة -->
            <div class="quo-total-box">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 6px;">
                <div style="font-size: 1.05rem; font-weight: 800; color: #0f2744;">
                  المجموع الكلي النهائي (${items.length} بند):
                </div>
                <div style="font-size: 1.28rem; font-weight: 900; color: #059669; font-family: monospace;">
                  ${App.formatNumber(grandTotal)} ${curr}
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1.8fr 1.2fr; gap: 10px; font-size: 0.82rem;">
                <div>
                  <div style="font-weight: 700; color: #0f2744; margin-bottom: 2px;">المبلغ كتابة:</div>
                  <div style="color: #1e293b; font-weight: 600;">${tafqeetWords}</div>
                </div>
                <div>
                  <div style="font-weight: 700; color: #0f2744; margin-bottom: 2px;">الشروط والملاحظات التعاقدية:</div>
                  <div style="color: #b91c1c; font-weight: 700;">📌 ${notes}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- قسم التوقيعات والاعتمادات الرسمية -->
          <div>
            <div class="quo-sigs-grid">
              <div>
                <div style="font-weight: 800; color: #0f2744;">إعداد المهندس المشرف</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">التوقيع والتاريخ</div>
              </div>
              <div>
                <div style="font-weight: 800; color: #0f2744;">التدقيق والمراجعة المالية</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">التوقيع والتاريخ</div>
              </div>
              <div>
                <div style="font-weight: 800; color: #0f2744;">اعتماد شركة رواسي عدن</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">(الختم والتوقيع الرسمي)</div>
              </div>
              <div>
                <div style="font-weight: 800; color: #0f2744;">موافقة واعتماد العميل</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">${contractOwner}</div>
              </div>
            </div>

            <div style="text-align: center; font-size: 0.68rem; color: #64748b; margin-top: 8px;">
              عرض السعر صادر رسمياً عبر نظام شركة رواسي عدن للهندسة والمقاولات — طبع بتاريخ: ${new Date().toLocaleDateString('ar-YE')}
            </div>
          </div>
        </div>
      `;
    } else {
      const page1Items = items.slice(0, 18);
      const page2Items = items.slice(18);
      const page1Subtotal = page1Items.reduce((acc, it) => acc + Number(it.total || 0), 0);
      const page2Subtotal = page2Items.reduce((acc, it) => acc + Number(it.total || 0), 0);

      pagesHtml = `
        <!-- ================== الصفحة الأولى (البنود 1 إلى 18) ================== -->
        <div class="quo-print-page">
          <div>
            <!-- رأس الصفحة والهوية -->
            <div class="quo-header-box">
              <div class="quo-company-row">
                <div>
                  <h2 style="margin: 0; color: #0f2744; font-size: 1.15rem; font-weight: 800;">شركة رواسي عدن للهندسة والمقاولات</h2>
                  <div style="font-size: 0.72rem; color: #475569; font-weight: 600;">Rawasi Aden for Engineering & Contracting</div>
                </div>
                <div style="text-align: left; font-size: 0.72rem; color: #475569; line-height: 1.3;">
                  <div>عدن - الجمهورية اليمنية</div>
                  <div>هاتف: 773413937 - 772332164</div>
                  <div>س.ت: 102948 | ر.ض: 3004918</div>
                </div>
              </div>

              <div class="quo-title-badge">
                عـرض سـعـر — QUOTATION OFFER (صفحة 1 من 2)
              </div>

              <div class="quo-meta-grid">
                <div class="quo-meta-item">
                  <span class="quo-meta-label">السادة:</span>
                  <span style="font-weight: 700; color: #0f2744;">${contractOwner}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">رقم العرض:</span>
                  <span style="font-family: monospace; font-weight: 800; color: #0f2744;">${quoNo}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">التاريخ:</span>
                  <span>${quoDate}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">المشروع:</span>
                  <span style="font-weight: 700;">${projName}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">هاتف العميل:</span>
                  <span style="font-family: monospace;">${clientPhone}</span>
                </div>
                <div class="quo-meta-item">
                  <span class="quo-meta-label">صالح حتى:</span>
                  <span>${validUntil}</span>
                </div>
              </div>
            </div>

            <!-- جدول البنود (الصفحة الأولى) -->
            <table class="quo-official-table">
              <thead>
                <tr>
                  <th style="width: 32px;">م</th>
                  <th>وصف وبيان البند</th>
                  <th style="width: 55px;">الوحدة</th>
                  <th style="width: 48px;">الكمية</th>
                  <th style="width: 80px;">سعر الوحدة (${curr})</th>
                  <th style="width: 85px;">الإجمالي (${curr})</th>
                </tr>
              </thead>
              <tbody>
                ${page1Items.map(it => `
                  <tr>
                    <td style="text-align: center; font-weight: bold;">${it.item_no}</td>
                    <td style="font-weight: 600;">${it.description || 'بند أعمال'}</td>
                    <td style="text-align: center;">${it.unit || 'وحدة'}</td>
                    <td style="text-align: center; font-weight: bold;">${it.quantity}</td>
                    <td style="text-align: center; font-family: monospace;">${App.formatNumber(it.unit_price)}</td>
                    <td style="text-align: center; font-weight: bold; font-family: monospace;">${App.formatNumber(it.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- تذييل الصفحة الأولى -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; background: #e2e8f0; padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; font-weight: 800; border: 1px solid #cbd5e1; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
              <div>المجموع الجزئي للصفحة الأولى (${page1Items.length} بند): <span style="font-family: monospace; color: #0f2744; font-size: 0.92rem;">${App.formatNumber(page1Subtotal)} ${curr}</span></div>
              <div style="color: #475569;">صفحة 1 من 2 — (يتبع في الصفحة التالية ⬅️)</div>
            </div>
          </div>
        </div>

        <!-- ================== الصفحة الثانية (البنود المتبقية) ================== -->
        <div class="quo-print-page">
          <div>
            <!-- رأس الصفحة الثانية المختصر -->
            <div class="quo-header-box" style="padding: 8px 12px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #d4af37; padding-bottom: 4px; margin-bottom: 6px;">
                <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem;">
                  شركة رواسي عدن للهندسة والمقاولات — تابع عرض سعر رقم: <span style="font-family: monospace;">${quoNo}</span>
                </div>
                <div style="font-size: 0.74rem; color: #475569;">
                  المشروع: <b>${projName}</b> | السادة (صاحب العقد): <b>${contractOwner}</b>
                </div>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 0.78rem;">
                <div>تاريخ العرض: <b>${quoDate}</b></div>
                <div>صالح حتى: <b>${validUntil}</b></div>
                <div style="font-weight: 800; color: #059669;">صفحة 2 من 2 (تتمة البنود والاعتماد النهائي)</div>
              </div>
            </div>

            <!-- جدول البنود (الصفحة الثانية) -->
            <table class="quo-official-table">
              <thead>
                <tr>
                  <th style="width: 32px;">م</th>
                  <th>وصف وبيان البند</th>
                  <th style="width: 55px;">الوحدة</th>
                  <th style="width: 48px;">الكمية</th>
                  <th style="width: 80px;">سعر الوحدة (${curr})</th>
                  <th style="width: 85px;">الإجمالي (${curr})</th>
                </tr>
              </thead>
              <tbody>
                ${page2Items.map(it => `
                  <tr>
                    <td style="text-align: center; font-weight: bold;">${it.item_no}</td>
                    <td style="font-weight: 600;">${it.description || 'بند أعمال'}</td>
                    <td style="text-align: center;">${it.unit || 'وحدة'}</td>
                    <td style="text-align: center; font-weight: bold;">${it.quantity}</td>
                    <td style="text-align: center; font-family: monospace;">${App.formatNumber(it.unit_price)}</td>
                    <td style="text-align: center; font-weight: bold; font-family: monospace;">${App.formatNumber(it.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <!-- صندوق الإجماليات والملاحظات والمبلغ كتابة -->
            <div class="quo-total-box">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 6px;">
                <div style="font-size: 1.05rem; font-weight: 800; color: #0f2744;">
                  المجموع الكلي النهائي (${items.length} بند):
                </div>
                <div style="font-size: 1.28rem; font-weight: 900; color: #059669; font-family: monospace;">
                  ${App.formatNumber(grandTotal)} ${curr}
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1.8fr 1.2fr; gap: 10px; font-size: 0.82rem;">
                <div>
                  <div style="font-weight: 700; color: #0f2744; margin-bottom: 2px;">المبلغ كتابة:</div>
                  <div style="color: #1e293b; font-weight: 600;">${tafqeetWords}</div>
                </div>
                <div>
                  <div style="font-weight: 700; color: #0f2744; margin-bottom: 2px;">الشروط والملاحظات التعاقدية:</div>
                  <div style="color: #b91c1c; font-weight: 700;">📌 ${notes}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- قسم التوقيعات والاعتمادات الرسمية -->
          <div>
            <div class="quo-sigs-grid">
              <div>
                <div style="font-weight: 800; color: #0f2744;">إعداد المهندس المشرف</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">التوقيع والتاريخ</div>
              </div>
              <div>
                <div style="font-weight: 800; color: #0f2744;">التدقيق والمراجعة المالية</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">التوقيع والتاريخ</div>
              </div>
              <div>
                <div style="font-weight: 800; color: #0f2744;">اعتماد شركة رواسي عدن</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">(الختم والتوقيع الرسمي)</div>
              </div>
              <div>
                <div style="font-weight: 800; color: #0f2744;">موافقة واعتماد العميل</div>
                <div class="quo-sig-space"></div>
                <div style="border-top: 1px solid #94a3b8; padding-top: 2px; color: #475569;">${contractOwner}</div>
              </div>
            </div>

            <div style="text-align: center; font-size: 0.68rem; color: #64748b; margin-top: 8px;">
              عرض السعر صادر رسمياً عبر نظام شركة رواسي عدن للهندسة والمقاولات — طبع بتاريخ: ${new Date().toLocaleDateString('ar-YE')}
            </div>
          </div>
        </div>
      `;
    }

    printArea.innerHTML = `
      <style>
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 12mm 10mm 12mm;
          }
          body {
            background: #fff !important;
            color: #000 !important;
            font-family: 'Cairo', 'Tajawal', Tahoma, sans-serif !important;
          }
          .quo-print-page {
            page-break-after: always;
            break-after: page;
            min-height: 98vh;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 8px 0;
            box-sizing: border-box;
          }
          .quo-print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }

        .quo-doc-wrapper {
          width: 100%;
          max-width: 820px;
          margin: 0 auto;
          font-family: 'Cairo', Tahoma, sans-serif;
          color: #0f172a;
          direction: rtl;
        }

        .quo-header-box {
          border: 2px solid #0f2744;
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 10px;
          background: #f8fafc;
        }

        .quo-company-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1.5px solid #d4af37;
          padding-bottom: 6px;
          margin-bottom: 8px;
        }

        .quo-meta-grid {
          display: grid;
          grid-template-columns: 1.4fr 1.2fr 1fr;
          gap: 6px;
          font-size: 0.82rem;
          line-height: 1.45;
        }

        .quo-meta-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .quo-meta-label {
          font-weight: 800;
          color: #0f2744;
        }

        .quo-title-badge {
          background: #0f2744;
          color: #fff;
          text-align: center;
          padding: 4px 10px;
          border-radius: 4px;
          font-weight: 800;
          font-size: 0.95rem;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
          border: 1px solid #d4af37;
        }

        .quo-official-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.76rem;
          line-height: 1.2;
          margin-bottom: 6px;
        }

        .quo-official-table th {
          background: #0f2744 !important;
          color: #fff !important;
          border: 1px solid #0f2744;
          padding: 5px 4px;
          text-align: center;
          font-weight: 800;
          font-size: 0.78rem;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .quo-official-table td {
          border: 1px solid #94a3b8;
          padding: 4.5px 5px;
          color: #0f172a;
          vertical-align: middle;
        }

        .quo-official-table tr:nth-child(even) td {
          background: #f8fafc;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .quo-total-box {
          border: 2px solid #0f2744;
          border-radius: 6px;
          background: #f8fafc;
          padding: 8px 12px;
          margin-top: 6px;
          font-size: 0.82rem;
        }

        .quo-sigs-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          text-align: center;
          margin-top: 14px;
          padding-top: 8px;
          border-top: 1.5px dashed #94a3b8;
          font-size: 0.78rem;
        }

        .quo-sig-space {
          height: 38px;
          margin-top: 4px;
        }
      </style>

      <div class="quo-doc-wrapper">
        ${pagesHtml}
      </div>
    `;

    // أرشفة نسخة التقرير تلقائياً داخل مجلد المشروع الفعلي على القرص
    if (this.saveReportToProjectFolder) {
      this.saveReportToProjectFolder('عرض_سعر', `عرض_سعر_رسمي_${quoNo}`, printArea.innerHTML, 'html', '03_عروض_الأسعار_والمقايسات');
    }

    printArea.style.display = 'block';
    printArea.style.visibility = 'visible';

    const cleanup = () => {
      printArea.style.display = 'none';
      printArea.style.visibility = 'hidden';
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();

    // إخفاء احتياطي بعد دقيقة في حال عدم إطلاق حدث afterprint بالمتصفح
    setTimeout(cleanup, 60000);
  }
};

if (typeof window !== 'undefined') {
  window.ProjectHub = ProjectHub;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProjectHub;
}

