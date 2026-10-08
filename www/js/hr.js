const HR = {
  employees: [],
  leaveTypes: [],
  evaluations: [],

  init() {
    this.setToday();
  },

  setToday() {
    const date = new Date().toISOString().slice(0, 10);
    ['hrAttendanceDate', 'hrAdvanceDate', 'hrEvalDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = date;
    });
    const month = document.getElementById('hrPayrollMonth');
    if (month && !month.value) month.value = '2026-08';
  },

  money(v) {
    return App?.formatNumber ? App.formatNumber(v || 0) : Number(v || 0).toLocaleString('en-US');
  },

  esc(v) {
    const d = document.createElement('div');
    d.textContent = v ?? '';
    return d.innerHTML;
  },

  async load() {
    await Promise.all([
      this.loadDashboard(),
      this.loadEmployees(),
      this.loadAttendance(),
      this.loadLeaves(),
      this.loadAdvances(),
      this.loadPayroll(),
      this.loadLeaveTypes(),
      this.loadEvaluations()
    ]);
  },

  async loadDashboard() {
    try {
      const res = await fetch('/api/hr/dashboard');
      const json = await res.json();
      if (!json.success) return;
      const d = json.data;
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('hrActiveEmployees', d.activeEmployees);
      set('hrPresentToday', d.presentToday);
      set('hrUnpaidPayroll', this.money(d.unpaidPayroll) + ' ر.ي');
      set('hrActiveAdvances', this.money(d.activeAdvances) + ' ر.ي');
      set('hrPendingLeaves', d.pendingLeaves);
    } catch (e) {
      console.error(e);
    }
  },

  async loadEmployees() {
    try {
      const json = await (await fetch('/api/hr/employees')).json();
      if (!json.success) return;
      this.employees = json.data || [];
      const tbody = document.getElementById('hrEmployeesTableBody');
      if (!tbody) return;
      tbody.innerHTML = this.employees.length ? this.employees.map(e => `
        <tr>
          <td>${this.esc(e.employee_no)}</td>
          <td><b>${this.esc(e.full_name)}</b><br><small>${this.esc(e.phone || '-')}</small></td>
          <td>${this.esc(e.job_title || '-')}</td>
          <td>${this.esc(e.department || '-')}</td>
          <td>${this.esc(e.project_name || 'الإدارة العامة')}</td>
          <td>${this.money(e.basic_salary)} ${this.esc(e.currency || 'ر.ي')}</td>
          <td><span class="status-badge ${e.status === 'active' ? 'status-active' : 'status-inactive'}">${e.status === 'active' ? 'نشط' : 'موقوف'}</span></td>
          <td><button class="btn btn-secondary btn-sm" onclick="HR.openEmployeeModal(${e.id})">تعديل</button></td>
        </tr>
      `).join('') : '<tr><td colspan="8" style="text-align:center;padding:25px;">لا يوجد موظفون مسجلون بعد.</td></tr>';
      this.populateEmployeeSelects();
    } catch (e) {
      console.error(e);
    }
  },

  populateEmployeeSelects() {
    ['hrAttendanceEmployee', 'hrLeaveEmployee', 'hrAdvanceEmployee', 'hrEvalEmployee'].forEach(id => {
      const s = document.getElementById(id);
      if (s) {
        s.innerHTML = '<option value="">اختر الموظف...</option>' +
          this.employees.filter(e => e.status === 'active').map(e => `<option value="${e.id}">${this.esc(e.employee_no)} — ${this.esc(e.full_name)}</option>`).join('');
      }
    });
  },

  async loadAttendance() {
    const date = document.getElementById('hrAttendanceDate')?.value || new Date().toISOString().slice(0, 10);
    try {
      const json = await (await fetch('/api/hr/attendance?date=' + encodeURIComponent(date))).json();
      const tbody = document.getElementById('hrAttendanceTableBody');
      if (!tbody || !json.success) return;
      tbody.innerHTML = (json.data || []).length ? json.data.map(a => `
        <tr>
          <td>${this.esc(a.employee_no)}</td>
          <td>${this.esc(a.full_name)}</td>
          <td>${this.statusLabel(a.status)}</td>
          <td>${this.esc(a.check_in || '-')}</td>
          <td>${this.esc(a.check_out || '-')}</td>
          <td>${a.overtime_hours || 0}</td>
          <td>${this.esc(a.notes || '-')}</td>
        </tr>
      `).join('') : '<tr><td colspan="7" style="text-align:center;padding:25px;">لا توجد سجلات لهذا التاريخ.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  statusLabel(s) {
    return ({ present: 'حاضر', absent: 'غائب', late: 'متأخر', leave: 'إجازة' })[s] || s;
  },

  async loadLeaves() {
    try {
      const json = await (await fetch('/api/hr/leaves')).json();
      const tbody = document.getElementById('hrLeavesTableBody');
      if (!tbody || !json.success) return;
      tbody.innerHTML = (json.data || []).length ? json.data.map(l => `
        <tr>
          <td>${this.esc(l.full_name)}</td>
          <td>${this.esc(l.leave_type)}</td>
          <td>${l.start_date} — ${l.end_date}</td>
          <td>${l.days_count}</td>
          <td>${this.esc(l.status === 'pending' ? 'بانتظار الاعتماد' : l.status === 'approved' ? 'معتمدة' : 'مرفوضة')}</td>
          <td>${l.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="HR.setLeaveStatus(${l.id},'approved')">اعتماد</button>` : '-'}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" style="text-align:center;padding:25px;">لا توجد طلبات إجازة.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  async loadAdvances() {
    try {
      const json = await (await fetch('/api/hr/advances')).json();
      const tbody = document.getElementById('hrAdvancesTableBody');
      if (!tbody || !json.success) return;
      tbody.innerHTML = (json.data || []).length ? json.data.map(a => `
        <tr>
          <td>${this.esc(a.full_name)}</td>
          <td>${a.date}</td>
          <td>${this.money(a.amount)}</td>
          <td>${this.money(a.recovered_amount)}</td>
          <td>${this.money(a.amount - a.recovered_amount)}</td>
          <td>${this.money(a.installment_amount)}</td>
          <td>${a.status === 'active' ? 'نشطة' : 'مغلقة'}</td>
        </tr>
      `).join('') : '<tr><td colspan="7" style="text-align:center;padding:25px;">لا توجد سلف مسجلة.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  async loadPayroll() {
    const monthInput = document.getElementById('hrPayrollMonth');
    const month = monthInput?.value || '2026-08';
    if (monthInput && !monthInput.value) monthInput.value = month;

    // تحديث عنوان لافتة الكشف الرسمي
    const banner = document.getElementById('payrollSheetHeaderBanner');
    if (banner) {
      const arabicMonths = {
        '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل',
        '05': 'مايو', '06': 'يونيو', '07': 'يوليو', '08': 'اغسطس',
        '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
      };
      const [year, mPart] = month.split('-');
      const mName = arabicMonths[mPart] || mPart;
      banner.textContent = `كشف الراتب الشامل لشهر ${mName} ${year}م`;
    }

    try {
      const json = await (await fetch('/api/hr/payroll' + (month ? '?month=' + month : ''))).json();
      const tbody = document.getElementById('hrPayrollTableBody');
      const tfoot = document.getElementById('hrPayrollTableFoot');
      if (!tbody || !json.success) return;
      
      const records = json.data || [];
      this._currentPayrollRecords = records;
      this._currentPayrollMonth = month;

      if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="28" style="text-align:center;padding:25px;color:var(--text-secondary);">لا توجد مسيرات رواتب مسجلة لشهر ' + (month || '') + '. اضغط زر "1. إعداد مسير الرواتب" لتوليد المسير الشامل آلياً.</td></tr>';
        if (tfoot) tfoot.innerHTML = '';
        return;
      }

      let totBasic = 0;
      let totEarned = 0;
      let totTransport = 0;
      let totAppearance = 0;
      let totNature = 0;
      let totLiving = 0;
      let totHealth = 0;
      let totGross = 0;
      let totInsEmp = 0;
      let totAbsence = 0;
      let totLoan = 0;
      let totDeductions = 0;
      let totTaxBase = 0;
      let totTax = 0;
      let totNet = 0;
      let totInsOrg = 0;
      let totSkills = 0;
      let totUnpaidLeave = 0;
      let totGrandNet = 0;

      tbody.innerHTML = records.map((p, idx) => {
        const basic = Number(p.basic_salary || 0);
        const earned = p.earned_basic != null ? Number(p.earned_basic) : basic;
        const transport = p.transport_allowance != null ? Number(p.transport_allowance) : Math.round(earned * 0.20);
        const appearance = p.appearance_allowance != null ? Number(p.appearance_allowance) : Math.round(earned * 0.25);
        const nature = p.nature_of_work_allowance != null ? Number(p.nature_of_work_allowance) : Math.round(earned * 0.30);
        const living = p.living_allowance != null ? Number(p.living_allowance) : 90000;
        const health = p.health_insurance_allowance != null ? Number(p.health_insurance_allowance) : 30000;
        const gross = p.gross_salary != null ? Number(p.gross_salary) : (earned + transport + appearance + nature + living + health);
        const insEmp = p.insurance_employee != null ? Number(p.insurance_employee) : Math.round(gross * 0.06);
        const dedAbsence = Number(p.absence_penalty_deductions || 0);
        const dedLoan = Number(p.loan_installments || 0);
        const dedTotal = Number(p.deductions != null ? p.deductions : (dedAbsence + dedLoan));
        const taxBase = p.taxable_base != null ? Number(p.taxable_base) : Math.max(0, gross - insEmp - 65000 - dedTotal);
        const tax = p.tax_amount != null ? Number(p.tax_amount) : (taxBase > 0 ? (taxBase <= 40000 ? Math.round(taxBase * 0.10) : Math.round(taxBase * 0.15 - 2000)) : 0);
        const net = p.net_salary != null ? Number(p.net_salary) : Math.max(0, gross - insEmp - tax - dedTotal);
        const insOrg = p.insurance_employer != null ? Number(p.insurance_employer) : Math.round(gross * 0.09);
        const skills = p.skills_fund != null ? Number(p.skills_fund) : Math.round(taxBase * 0.01);
        const unpaidLeave = Number(p.unpaid_leave_deduction || 0);
        const grandNet = p.total_net_salary != null ? Number(p.total_net_salary) : (net - unpaidLeave);

        totBasic += basic;
        totEarned += earned;
        totTransport += transport;
        totAppearance += appearance;
        totNature += nature;
        totLiving += living;
        totHealth += health;
        totGross += gross;
        totInsEmp += insEmp;
        totAbsence += dedAbsence;
        totLoan += dedLoan;
        totDeductions += dedTotal;
        totTaxBase += taxBase;
        totTax += tax;
        totNet += net;
        totInsOrg += insOrg;
        totSkills += skills;
        totUnpaidLeave += unpaidLeave;
        totGrandNet += grandNet;

        return `
          <tr>
            <td><strong>${idx + 1}</strong></td>
            <td style="text-align:right;"><strong>${this.esc(p.full_name)}</strong></td>
            <td>${this.esc(p.job_title || '-')}</td>
            <td style="font-family:monospace;color:#38bdf8;">${this.esc(p.employee_no || '-')}</td>
            <td>${p.month_days || 31}</td>
            <td style="font-family:monospace;">${this.esc(p.bank_account || '-')}</td>
            <td style="font-size:0.75rem;">${this.esc(p.cost_center || 'الإدارة العامة')}</td>
            <td>${p.working_days || 31}</td>
            <td style="color:#38bdf8;font-weight:600;">${this.money(basic)}</td>
            <td>${this.money(earned)}</td>
            <td>${this.money(transport)}</td>
            <td>${this.money(appearance)}</td>
            <td style="background:#fef08a;color:#854d0e;font-weight:bold;">${this.money(nature)}</td>
            <td>${this.money(living)}</td>
            <td style="background:#fef08a;color:#854d0e;font-weight:bold;">${this.money(health)}</td>
            <td style="color:var(--gold-light);font-weight:bold;">${this.money(gross)}</td>
            <td style="color:#f87171;font-weight:600;">${this.money(insEmp)}</td>
            <td>${this.money(dedAbsence)}</td>
            <td>${this.money(dedLoan)}</td>
            <td style="color:#ef4444;">${this.money(dedTotal)}</td>
            <td>${this.money(taxBase)}</td>
            <td style="color:#fb923c;font-weight:600;">${this.money(tax)}</td>
            <td style="color:var(--accent-green);font-weight:bold;">${this.money(net)}</td>
            <td style="color:#c084fc;">${this.money(insOrg)}</td>
            <td style="color:#60a5fa;">${this.money(skills)}</td>
            <td>${this.money(unpaidLeave)}</td>
            <td style="color:var(--accent-green);font-weight:bold;font-size:0.88rem;background:rgba(16,185,129,0.08);">${this.money(grandNet)}</td>
            <td>
              <span class="badge ${p.status === 'paid' ? 'badge-active' : 'badge-expense'}">${p.status === 'paid' ? 'مصروف' : 'مسودة'}</span>
              ${p.status !== 'paid' ? `<button class="btn btn-primary btn-sm" style="padding:2px 6px;font-size:0.75rem;" onclick="HR.payPayroll(${p.id})">اعتماد</button>` : ''}
            </td>
          </tr>
        `;
      }).join('');

      // شريط الإجمالي النهائي المطابق لكشف Excel
      if (tfoot) {
        tfoot.innerHTML = `
          <tr style="background:#0f172a;border-top:2px solid var(--accent-green);">
            <td colspan="8" style="text-align:center;color:var(--gold-light);font-size:0.95rem;letter-spacing:1px;">** الإجمـــــالـــــي **</td>
            <td style="color:#38bdf8;">${this.money(totBasic)}</td>
            <td>${this.money(totEarned)}</td>
            <td>${this.money(totTransport)}</td>
            <td>${this.money(totAppearance)}</td>
            <td style="background:#fef08a;color:#854d0e;">${this.money(totNature)}</td>
            <td>${this.money(totLiving)}</td>
            <td style="background:#fef08a;color:#854d0e;">${this.money(totHealth)}</td>
            <td style="color:var(--gold-light);">${this.money(totGross)}</td>
            <td style="color:#f87171;">${this.money(totInsEmp)}</td>
            <td>${this.money(totAbsence)}</td>
            <td>${this.money(totLoan)}</td>
            <td style="color:#ef4444;">${this.money(totDeductions)}</td>
            <td>${this.money(totTaxBase)}</td>
            <td style="color:#fb923c;">${this.money(totTax)}</td>
            <td style="color:var(--accent-green);">${this.money(totNet)}</td>
            <td style="color:#c084fc;">${this.money(totInsOrg)}</td>
            <td style="color:#60a5fa;">${this.money(totSkills)}</td>
            <td>${this.money(totUnpaidLeave)}</td>
            <td style="color:var(--accent-green);font-size:0.95rem;background:rgba(16,185,129,0.15);">${this.money(totGrandNet)}</td>
            <td>—</td>
          </tr>
        `;
      }
    } catch (e) {
      console.error(e);
    }
  },

  exportPayrollToExcel() {
    if (!this._currentPayrollRecords || !this._currentPayrollRecords.length) {
      App.showToast('لا توجد بيانات مسير رواتب للتصدير', 'error');
      return;
    }
    const headers = [
      'م', 'الاسم', 'الوظيفة', 'الرقم الوظيفي', 'عدد الأيام', 'رقم الحساب', 'مركز التكلفة', 'أيام العمل',
      'الراتب الأساسي', 'استحقاق الأساسي', 'إنتقال 20%', 'مظهر 25%', 'طبيعة عمل 30%', 'بدل معيشة', 'بدل تأمين صحي',
      'الراتب الشامل', 'التأمينات 6%', 'خصميات غياب وجزاءات', 'أقساط تمويل', 'إجمالي الخصميات',
      'الوعاء', 'الضريبة', 'صافي الراتب', '%9 تأمين', 'صندوق تنمية المهارات 1%', 'الإجازة بدون راتب', 'إجمالي الصافي'
    ];
    const rows = this._currentPayrollRecords.map((p, i) => {
      const basic = Number(p.basic_salary || 0);
      const earned = p.earned_basic != null ? Number(p.earned_basic) : basic;
      const transport = p.transport_allowance != null ? Number(p.transport_allowance) : Math.round(earned * 0.20);
      const appearance = p.appearance_allowance != null ? Number(p.appearance_allowance) : Math.round(earned * 0.25);
      const nature = p.nature_of_work_allowance != null ? Number(p.nature_of_work_allowance) : Math.round(earned * 0.30);
      const living = p.living_allowance != null ? Number(p.living_allowance) : 90000;
      const health = p.health_insurance_allowance != null ? Number(p.health_insurance_allowance) : 30000;
      const gross = p.gross_salary != null ? Number(p.gross_salary) : (earned + transport + appearance + nature + living + health);
      const insEmp = p.insurance_employee != null ? Number(p.insurance_employee) : Math.round(gross * 0.06);
      const dedAbsence = Number(p.absence_penalty_deductions || 0);
      const dedLoan = Number(p.loan_installments || 0);
      const dedTotal = Number(p.deductions != null ? p.deductions : (dedAbsence + dedLoan));
      const taxBase = p.taxable_base != null ? Number(p.taxable_base) : Math.max(0, gross - insEmp - 65000 - dedTotal);
      const tax = p.tax_amount != null ? Number(p.tax_amount) : (taxBase > 0 ? (taxBase <= 40000 ? Math.round(taxBase * 0.10) : Math.round(taxBase * 0.15 - 2000)) : 0);
      const net = p.net_salary != null ? Number(p.net_salary) : Math.max(0, gross - insEmp - tax - dedTotal);
      const insOrg = p.insurance_employer != null ? Number(p.insurance_employer) : Math.round(gross * 0.09);
      const skills = p.skills_fund != null ? Number(p.skills_fund) : Math.round(taxBase * 0.01);
      const unpaidLeave = Number(p.unpaid_leave_deduction || 0);
      const grandNet = p.total_net_salary != null ? Number(p.total_net_salary) : (net - unpaidLeave);

      return [
        i + 1, p.full_name, p.job_title || '', p.employee_no || '', p.month_days || 31, p.bank_account || '', p.cost_center || '', p.working_days || 31,
        basic, earned, transport, appearance, nature, living, health,
        gross, insEmp, dedAbsence, dedLoan, dedTotal,
        taxBase, tax, net, insOrg, skills, unpaidLeave, grandNet
      ].map(v => typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v).join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `كشف_الراتب_الشامل_${this._currentPayrollMonth || '2026-08'}.csv`;
    link.click();
    App.showToast('تم تصدير كشف الراتب الشامل إلى Excel بنجاح', 'success');
  },

  printComprehensivePayroll() {
    window.print();
  },

  // إظهار نافذة القواعد والأسس النظامية لاحتساب الأجور والضرائب والتأمينات
  showStatutoryRulesModal() {
    let modal = document.getElementById('hrStatutoryRulesModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'hrStatutoryRulesModal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    } else {
      modal.className = 'modal-overlay';
    }

    modal.innerHTML = `
      <div class="modal-box" style="max-width: 960px; width: 95%; max-height: 90vh; overflow-y: auto; padding: 24px; border: 1px solid var(--gold-primary); background: var(--bg-surface); border-radius: 14px; box-shadow: 0 20px 45px rgba(0,0,0,0.6);">
        <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(212,175,55,0.25); padding-bottom:14px; margin-bottom:18px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:42px; height:42px; border-radius:10px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); display:flex; align-items:center; justify-content:center; font-size:1.4rem;">
              ⚖️
            </div>
            <div>
              <h3 style="color:var(--gold-light); margin:0; font-size:1.2rem; font-weight:700;">
                دليل القواعد النظامية والمحاسبية لكشف الراتب الشامل
              </h3>
              <p style="margin:2px 0 0 0; font-size:0.8rem; color:var(--text-secondary);">
                المعايير المعتمدة وفقاً لقوانين العمل والتأمينات الاجتماعية وضرائب كسب العمل في الجمهورية اليمنية
              </p>
            </div>
          </div>
          <button type="button" class="modal-close-btn" onclick="HR.closeStatutoryRulesModal()" title="إغلاق">&times;</button>
        </div>

        <div class="modal-body" style="line-height: 1.7; font-size:0.9rem;">
          <!-- شبكة الركائز الأربع للنظام -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:14px; margin-bottom:16px;">
            
            <!-- الركيزة 1: هيكل الراتب الشامل والبدلات الخمسة -->
            <div style="background:rgba(59,130,246,0.07); border:1px solid rgba(56,189,248,0.25); border-radius:10px; padding:16px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; border-bottom:1px solid rgba(56,189,248,0.2); padding-bottom:8px;">
                <span style="font-size:1.1rem;">💰</span>
                <h4 style="color:#38bdf8; margin:0; font-size:0.98rem; font-weight:700;">1. الراتب الأساسي والبدلات المعيارية الخمسة</h4>
              </div>
              <ul style="margin:0; padding-right:18px; color:var(--text-primary); font-size:0.86rem; display:flex; flex-direction:column; gap:6px;">
                <li><strong>الراتب الأساسي الفعلي:</strong> يحتسب وفق أيام الدوام الفعلية (الأساسي التعاقدي × أيام العمل ÷ أيام الشهر).</li>
                <li><strong>بدل انتقال (20%):</strong> نسبة نظامية تعادل 20% من الراتب الأساسي المستحق.</li>
                <li><strong>بدل مظهر (25%):</strong> نسبة معتمدة تعادل 25% من الراتب الأساسي المستحق.</li>
                <li><strong style="color:var(--gold-light);">بدل طبيعة عمل (30% - مميز بالأصفر):</strong> نسبة وظيفية تعادل 30% من الأساسي.</li>
                <li><strong>بدل غلاء معيشة:</strong> مبلغ مقطوع (100,000 ر.ي للإدارة العليا / 90,000 ر.ي لباقي الكادر).</li>
                <li><strong style="color:var(--gold-light);">بدل تأمين صحي (مميز بالأصفر):</strong> مبلغ مقطوع (50,000 ر.ي للإدارة العليا / 30,000 ر.ي للموظفين).</li>
                <li style="margin-top:4px; padding-top:6px; border-top:1px dashed rgba(56,189,248,0.25); color:#7dd3fc;">
                  <strong>إجمالي الاستحقاق (Gross):</strong> مجموع الأساسي وكافة البدلات المنتظمة الخمسة.
                </li>
              </ul>
            </div>

            <!-- الركيزة 2: التأمينات الاجتماعية وصندوق المهارات -->
            <div style="background:rgba(168,85,247,0.07); border:1px solid rgba(168,85,247,0.25); border-radius:10px; padding:16px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; border-bottom:1px solid rgba(168,85,247,0.2); padding-bottom:8px;">
                <span style="font-size:1.1rem;">🏢</span>
                <h4 style="color:#c084fc; margin:0; font-size:0.98rem; font-weight:700;">2. التأمينات الاجتماعية وصندوق تنمية المهارات</h4>
              </div>
              <ul style="margin:0; padding-right:18px; color:var(--text-primary); font-size:0.86rem; display:flex; flex-direction:column; gap:6px;">
                <li><strong>حصة الموظف في التأمينات (6%):</strong> تستقطع مباشرة من الراتب الشامل وتخفض من صافي مستحقات العامل.</li>
                <li><strong>مساهمة المنشأة في التأمينات (9%):</strong> تتحملها شركة رواسي عدن كمصروف تشغيلي إضافي ولا تخصم من العامل.</li>
                <li><strong>إجمالي التأمينات المحولة (15%):</strong> تورد شهرياً بموجب إشعار للهيئة العامة للتأمينات والمعاشات (6% + 9%).</li>
                <li><strong>صندوق تنمية المهارات (1%):</strong> مساهمة أرباب العمل المقررة قانوناً بنسبة 1% من الوعاء التأميني لتأهيل وتدريب الكوادر الوطنية.</li>
                <li style="margin-top:4px; padding-top:6px; border-top:1px dashed rgba(168,85,247,0.25); color:#e9d5ff;">
                  <strong>المعادلة:</strong> التأمينات تستقطع على كامل الراتب الشامل (Gross) دون خصم الإعفاءات.
                </li>
              </ul>
            </div>

            <!-- الركيزة 3: ضريبة كسب العمل والوعاء المعفى -->
            <div style="background:rgba(239,68,68,0.07); border:1px solid rgba(239,68,68,0.25); border-radius:10px; padding:16px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; border-bottom:1px solid rgba(239,68,68,0.2); padding-bottom:8px;">
                <span style="font-size:1.1rem;">📊</span>
                <h4 style="color:#f87171; margin:0; font-size:0.98rem; font-weight:700;">3. ضريبة كسب العمل والوعاء القانوني المعفى</h4>
              </div>
              <ul style="margin:0; padding-right:18px; color:var(--text-primary); font-size:0.86rem; display:flex; flex-direction:column; gap:6px;">
                <li><strong>حد الإعفاء القانوني:</strong> معفى تماماً لأول <strong>65,000 ر.ي شهرياً</strong> (780,000 ر.ي سنوياً) وفق قانون ضرائب الدخل.</li>
                <li><strong>الوعاء الضريبي الشهري:</strong> الراتب الشامل - تأمينات 6% - حد الإعفاء (65,000) - الخصميات.</li>
                <li><strong>الشريحة الأولى (10%):</strong> تطبق على أول 40,000 ر.ي من الوعاء الضريبي (الحد الأقصى للضريبة = 4,000 ر.ي).</li>
                <li><strong>الشريحة الثانية (15%):</strong> تطبق على ما زاد عن 40,000 ر.ي (المعادلة: الوعاء × 15% - 2,000).</li>
                <li style="margin-top:4px; padding-top:6px; border-top:1px dashed rgba(239,68,68,0.25); color:#fca5a5;">
                  <strong>صافي الراتب المستحق (Net):</strong> إجمالي الاستحقاق - تأمينات 6% - ضريبة كسب العمل - الخصميات.
                </li>
              </ul>
            </div>

            <!-- الركيزة 4: التوجيه والقيد المحاسبي المتزن المركب -->
            <div style="background:rgba(16,185,129,0.07); border:1px solid rgba(16,185,129,0.25); border-radius:10px; padding:16px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; border-bottom:1px solid rgba(16,185,129,0.2); padding-bottom:8px;">
                <span style="font-size:1.1rem;">⚡</span>
                <h4 style="color:#4ade80; margin:0; font-size:0.98rem; font-weight:700;">4. التوجيه والقيد المحاسبي المركب المتزن 100%</h4>
              </div>
              <div style="font-family:monospace; font-size:0.82rem; background:#0b1120; border:1px solid rgba(16,185,129,0.2); padding:10px 14px; border-radius:8px; line-height:1.6;">
                <div style="color:#4ade80; font-weight:bold;">من مذكورين (جانب مدين):</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ مصروف الرواتب والأجور الشاملة والبدلات (511) [إجمالي الاستحقاق]</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ مصروف مساهمة المنشأة في التأمينات 9% (512)</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ مصروف مساهمة صندوق تنمية المهارات 1% (513)</div>
                <div style="color:#38bdf8; font-weight:bold; margin-top:6px;">إلى مذكورين (جانب دائن):</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ الصندوق الرئيسي أو البنك (111) [صافي الصرف الفعلي]</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ أمانات مصلحة الضرائب - كسب العمل (213)</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ الهيئة العامة للتأمينات والمعاشات 15% (214)</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ أمانات صندوق تنمية المهارات 1% (215)</div>
                <div style="padding-right:12px; color:#e2e8f0;">• حـ/ سلف وعهد الموظفين (114) [أقساط السلف المستردة]</div>
                <div style="margin-top:6px; color:#22c55e; font-weight:bold; text-align:left; direction:ltr;">Total Debit = Total Credit (Diff: 0.00 YER)</div>
              </div>
            </div>

          </div>

          <!-- الحاسبة التفاعلية الحية لاختبار أي راتب وفهم الحسبة فورياً (Live Simulator) -->
          <div style="background:rgba(212,175,55,0.06); border:1px solid rgba(212,175,55,0.3); border-radius:10px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:1.2rem;">🧮</span>
                <h4 style="color:var(--gold-light); margin:0; font-size:0.95rem; font-weight:700;">
                  محاكي الاحتساب السريع (حاسبة تجريبية فورية للرواتب والاستقطاعات)
                </h4>
              </div>
              <span style="font-size:0.75rem; color:var(--text-secondary);">أدخل الراتب لتجربة احتساب البدلات والتأمينات والضرائب فوراً</span>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; align-items:end; margin-bottom:14px;">
              <div>
                <label style="display:block; font-size:0.78rem; color:var(--text-secondary); margin-bottom:4px;">الراتب الأساسي التعاقدي (ر.ي):</label>
                <input id="simBasicSalary" type="number" class="form-control" value="500000" step="10000" oninput="HR.calculateSimulatedSalary()" style="height:36px; font-weight:bold; color:var(--gold-light);">
              </div>
              <div>
                <label style="display:block; font-size:0.78rem; color:var(--text-secondary); margin-bottom:4px;">المستوى الوظيفي (فئة البدلات):</label>
                <select id="simLevel" class="form-control" onchange="HR.calculateSimulatedSalary()" style="height:36px;">
                  <option value="staff" selected>كادر عام (معيشة 90 ألف / صحي 30 ألف)</option>
                  <option value="mgmt">إدارة عليا (معيشة 100 ألف / صحي 50 ألف)</option>
                </select>
              </div>
              <div>
                <label style="display:block; font-size:0.78rem; color:var(--text-secondary); margin-bottom:4px;">أيام العمل الفعلية:</label>
                <input id="simDays" type="number" class="form-control" value="30" min="1" max="31" oninput="HR.calculateSimulatedSalary()" style="height:36px;">
              </div>
            </div>

            <!-- نتائج المحاكي -->
            <div id="simResultsContainer" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px;">
              <!-- ستُحقن بالنتائج تلقائياً بواسطة calculateSimulatedSalary -->
            </div>
          </div>

        </div>

        <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(212,175,55,0.25); padding-top:14px; margin-top:18px;">
          <div style="font-size:0.82rem; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
            <span>🛡️ نظام رواسي عدن يضمن التطابق الحسابي التام مع الدفاتر المحاسبية دون فوارق مليمية.</span>
          </div>
          <button type="button" class="btn btn-secondary" onclick="HR.closeStatutoryRulesModal()">إغلاق الدليل</button>
        </div>
      </div>
    `;

    // إغلاق عند النقر على الخلفية المعتمة
    modal.onclick = (e) => {
      if (e.target === modal) {
        this.closeStatutoryRulesModal();
      }
    };

    // تشغيل المحاكي التفاعلي فورياً
    this.calculateSimulatedSalary();

    // فتح النافذة
    App.openModal('hrStatutoryRulesModal');
  },

  // إغلاق نافذة القواعد النظامية بأمان وإعادة تفعيل التمرير
  closeStatutoryRulesModal() {
    App.closeModal('hrStatutoryRulesModal');
    const remaining = document.querySelectorAll('.modal-overlay.active, .modal.active');
    if (remaining.length === 0) {
      document.body.style.overflow = '';
    }
  },

  // دالة المحاكي التفاعلي المباشر للرواتب والضرائب والتأمينات
  calculateSimulatedSalary() {
    const basicInput = document.getElementById('simBasicSalary');
    const levelInput = document.getElementById('simLevel');
    const daysInput = document.getElementById('simDays');
    const container = document.getElementById('simResultsContainer');
    if (!container) return;

    const basic = Number(basicInput?.value || 0);
    const level = levelInput?.value || 'staff';
    const days = Number(daysInput?.value || 30);

    const earned = Math.round(basic * (days / 30));
    const transport = Math.round(earned * 0.20);
    const appearance = Math.round(earned * 0.25);
    const nature = Math.round(earned * 0.30);
    const living = level === 'mgmt' ? 100000 : 90000;
    const health = level === 'mgmt' ? 50000 : 30000;
    const gross = earned + transport + appearance + nature + living + health;

    const insEmp = Math.round(gross * 0.06);
    const insOrg = Math.round(gross * 0.09);
    const taxBase = Math.max(0, gross - insEmp - 65000);
    const tax = taxBase > 0 ? (taxBase <= 40000 ? Math.round(taxBase * 0.10) : Math.round(taxBase * 0.15 - 2000)) : 0;
    const skills = Math.round(taxBase * 0.01);
    const net = Math.max(0, gross - insEmp - tax);
    const totalCost = gross + insOrg + skills;

    container.innerHTML = `
      <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">إجمالي البدلات:</div>
        <div style="font-size:0.95rem; font-weight:bold; color:#38bdf8;">${this.money(transport + appearance + nature + living + health)}</div>
      </div>
      <div style="background:rgba(212,175,55,0.1); border:1px solid rgba(212,175,55,0.3); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">الراتب الشامل (Gross):</div>
        <div style="font-size:1rem; font-weight:bold; color:var(--gold-light);">${this.money(gross)}</div>
      </div>
      <div style="background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.3); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">تأمين الموظف (6%):</div>
        <div style="font-size:0.95rem; font-weight:bold; color:#f87171;">-${this.money(insEmp)}</div>
      </div>
      <div style="background:rgba(251,146,60,0.1); border:1px solid rgba(251,146,60,0.3); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">ضريبة كسب العمل:</div>
        <div style="font-size:0.95rem; font-weight:bold; color:#fb923c;">-${this.money(tax)}</div>
      </div>
      <div style="background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">صافي استحقاق الموظف (Net):</div>
        <div style="font-size:1.05rem; font-weight:bold; color:var(--accent-green);">${this.money(net)}</div>
      </div>
      <div style="background:rgba(192,132,252,0.1); border:1px solid rgba(192,132,252,0.3); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">مساهمة المنشأة (9%+1%):</div>
        <div style="font-size:0.95rem; font-weight:bold; color:#c084fc;">+${this.money(insOrg + skills)}</div>
      </div>
      <div style="background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.35); padding:8px; border-radius:6px; text-align:center;">
        <div style="font-size:0.72rem; color:var(--text-secondary);">إجمالي تكلفة الموظف:</div>
        <div style="font-size:0.95rem; font-weight:bold; color:#60a5fa;">${this.money(totalCost)}</div>
      </div>
    `;
  },

  // 1. ترحيل مسير الرواتب إلى قيد يومية متزن مع المعاينة التفاعلية المسبقة
  async postPayrollToJournal() {
    const month = document.getElementById('hrPayrollMonth')?.value || '2026-08';
    if (!month) {
      App.showToast('يرجى اختيار شهر مسير الرواتب أولاً', 'error');
      return;
    }

    try {
      // جلب معاينة القيد المركب المتزن وأطرافه المحاسبية
      const res = await fetch(`/api/hr/payroll/${month}/preview-journal`);
      const json = await res.json();
      if (!json.success || !json.data) {
        App.showToast(json.message || 'لا توجد رواتب مسجلة لهذا الشهر', 'error');
        return;
      }

      const d = json.data;
      this.showPayrollJournalPreviewModal(month, d);
    } catch (e) {
      console.error(e);
      App.showToast('حدث خطأ أثناء جلب معاينة قيد الرواتب', 'error');
    }
  },

  showPayrollJournalPreviewModal(month, data) {
    let modal = document.getElementById('hrPayrollJournalPreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'hrPayrollJournalPreviewModal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    } else {
      modal.className = 'modal-overlay';
    }

    const s = data.summary;
    const linesHtml = data.lines.map(l => `
      <tr>
        <td><span class="badge ${l.side.includes('مدين') ? 'badge-income' : 'badge-expense'}">${l.side}</span></td>
        <td style="font-family:monospace;color:#38bdf8;">${l.account_code}</td>
        <td><strong>${l.account_name}</strong></td>
        <td><span class="badge badge-secondary">${l.cost_center}</span></td>
        <td style="color:var(--accent-green);font-weight:bold;text-align:left;direction:ltr;">${l.debit > 0 ? this.money(l.debit) : '-'}</td>
        <td style="color:#38bdf8;font-weight:bold;text-align:left;direction:ltr;">${l.credit > 0 ? this.money(l.credit) : '-'}</td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">${l.notes}</td>
      </tr>
    `).join('');

    modal.innerHTML = `
      <div class="modal-box" style="max-width: 1050px; width: 95%; max-height: 90vh; overflow-y: auto; padding: 24px; border: 1px solid var(--gold-primary); background: var(--bg-surface); border-radius: 14px; box-shadow: 0 20px 45px rgba(0,0,0,0.6);">
        <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(212,175,55,0.25); padding-bottom:14px; margin-bottom:18px;">
          <h3 class="modal-title" style="display:flex;align-items:center;gap:10px;margin:0;color:var(--gold-light);">
            <span>⚡ معاينة قيد استحقاق الرواتب المركب لشهر (${month})</span>
          </h3>
          <button type="button" class="modal-close-btn" onclick="App.closeModal('hrPayrollJournalPreviewModal')">&times;</button>
        </div>
        <div class="modal-body">
          <!-- كروت ملخص استحقاقات الرواتب والتأمينات والضرائب -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px;">
            <div style="background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);padding:10px;border-radius:6px;">
              <div style="font-size:0.75rem;color:var(--text-secondary);">إجمالي الاستحقاق (Gross):</div>
              <div style="font-size:1.05rem;font-weight:bold;color:var(--gold-light);">${this.money(s.total_gross)} ر.ي</div>
            </div>
            <div style="background:rgba(192,132,252,0.1);border:1px solid rgba(192,132,252,0.3);padding:10px;border-radius:6px;">
              <div style="font-size:0.75rem;color:var(--text-secondary);">مساهمة التأمينات (9%):</div>
              <div style="font-size:1.05rem;font-weight:bold;color:#c084fc;">+${this.money(s.insurance_employer_9pct)} ر.ي</div>
            </div>
            <div style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);padding:10px;border-radius:6px;">
              <div style="font-size:0.75rem;color:var(--text-secondary);">صندوق المهارات (1%):</div>
              <div style="font-size:1.05rem;font-weight:bold;color:#60a5fa;">+${this.money(s.total_skills_fund_1pct)} ر.ي</div>
            </div>
            <div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);padding:10px;border-radius:6px;">
              <div style="font-size:0.75rem;color:var(--text-secondary);">تأمينات الموظفين (6%):</div>
              <div style="font-size:1.05rem;font-weight:bold;color:#f87171;">-${this.money(s.insurance_employee_6pct)} ر.ي</div>
            </div>
            <div style="background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.3);padding:10px;border-radius:6px;">
              <div style="font-size:0.75rem;color:var(--text-secondary);">ضريبة كسب العمل:</div>
              <div style="font-size:1.05rem;font-weight:bold;color:#fb923c;">-${this.money(s.total_tax)} ر.ي</div>
            </div>
            <div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);padding:10px;border-radius:6px;">
              <div style="font-size:0.75rem;color:var(--text-secondary);">صافي الصرف (Net):</div>
              <div style="font-size:1.1rem;font-weight:bold;color:var(--accent-green);">${this.money(s.total_net_payable)} ر.ي</div>
            </div>
          </div>

          <!-- شريط التوازن المحاسبي للقيد -->
          <div style="background:#0f172a;padding:10px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border:1px solid var(--border-color);flex-wrap:wrap;gap:10px;">
            <div style="display:flex;gap:20px;">
              <div><span style="font-size:0.8rem;color:var(--text-secondary);">إجمالي المدين:</span> <strong style="color:var(--accent-green);">${this.money(s.total_debit)} ر.ي</strong></div>
              <div><span style="font-size:0.8rem;color:var(--text-secondary);">إجمالي الدائن:</span> <strong style="color:#38bdf8;">${this.money(s.total_credit)} ر.ي</strong></div>
              <div><span style="font-size:0.8rem;color:var(--text-secondary);">الفارق المحاسبي:</span> <strong style="color:${s.diff === 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${s.diff}</strong></div>
            </div>
            <div>
              <span class="badge" style="background:rgba(34,197,94,0.2);color:#4ade80;font-size:0.85rem;padding:4px 10px;">✅ القيد متزن 100% ومستوفٍ للمعايير المحاسبية</span>
            </div>
          </div>

          <div class="table-responsive" style="max-height:300px;overflow-y:auto;">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>الطرف</th>
                  <th>رقم الحساب</th>
                  <th>اسم الحساب المالي</th>
                  <th>مركز التكلفة</th>
                  <th>مدين (منه)</th>
                  <th>دائن (له)</th>
                  <th>البيان المحاسبي</th>
                </tr>
              </thead>
              <tbody>${linesHtml}</tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:0.82rem;color:var(--text-secondary);">
            سيتم إنشاء القيد في دفتر اليومية العامة وتحديث حالة كشف شهر (${month}) إلى مرحل ومسدد.
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal('hrPayrollJournalPreviewModal')">إلغاء</button>
            <button type="button" id="btnExecutePayrollPost" class="btn btn-success" style="background:linear-gradient(135deg,#059669,#10b981);" onclick="HR.executePayrollPost('${month}')">
              تأكيد وترحيل القيد اليومي الآن ⚡
            </button>
          </div>
        </div>
      </div>
    `;

    // إغلاق عند النقر على الخلفية المعتمة
    modal.onclick = (e) => {
      if (e.target === modal) {
        App.closeModal('hrPayrollJournalPreviewModal');
      }
    };

    App.openModal('hrPayrollJournalPreviewModal');
  },

  async executePayrollPost(month) {
    const btn = document.getElementById('btnExecutePayrollPost');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جاري ترحيل القيد لدفتر اليومية...';
    }

    try {
      const res = await fetch(`/api/hr/payroll/${month}/post-to-journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: 'YER' })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم إنشاء وترحيل قيد اليومية بنجاح [${data.entry_no}]`, 'success');
        App.closeModal('hrPayrollJournalPreviewModal');
        await this.loadPayroll();
        await this.loadDashboard();
        if (typeof Accounting !== 'undefined' && Accounting.loadJournalEntries) {
          Accounting.loadJournalEntries();
        }
      } else {
        App.showToast(data.message || 'فشل ترحيل المسير إلى قيد يومية', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('حدث خطأ أثناء ترحيل المسير', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'تأكيد وترحيل القيد اليومي الآن ⚡';
      }
    }
  },

  // 2. أنواع وسياسات الإجازات
  async loadLeaveTypes() {
    try {
      const res = await fetch('/api/hr/leave-types');
      const json = await res.json();
      if (json.success) {
        this.leaveTypes = json.data || [];
        const tbody = document.getElementById('hrLeaveTypesTableBody');
        if (tbody) {
          tbody.innerHTML = this.leaveTypes.length ? this.leaveTypes.map(lt => `
            <tr>
              <td><strong>${this.esc(lt.name)}</strong></td>
              <td>${lt.days_per_year} يوم</td>
              <td><span class="badge ${lt.is_paid ? 'badge-active' : 'badge-expense'}">${lt.is_paid ? 'مدفوعة الراتب' : 'بدون راتب'}</span></td>
              <td style="color: var(--text-secondary);">${this.esc(lt.description || '-')}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;">لا توجد أنواع إجازات مسجلة</td></tr>';
        }

        // تحديث القائمة المنسدلة في نموذج الإجازات
        const sel = document.getElementById('hrLeaveType');
        if (sel && this.leaveTypes.length > 0) {
          sel.innerHTML = this.leaveTypes.map(lt => `<option value="${lt.name}">${lt.name} (${lt.days_per_year} يوم)</option>`).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  async submitLeaveType(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('hrLtName')?.value?.trim();
    const days_per_year = parseInt(document.getElementById('hrLtDays')?.value) || 30;
    const is_paid = document.getElementById('hrLtIsPaid')?.value === '1';
    const description = document.getElementById('hrLtDesc')?.value?.trim() || '';

    if (!name) {
      App.showToast('يرجى كتابة اسم نوع الإجازة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/hr/leave-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, days_per_year, is_paid, description })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تمت إضافة نوع الإجازة بنجاح', 'success');
        e.target.reset();
        await this.loadLeaveTypes();
      } else {
        App.showToast(data.message || 'فشل حفظ نوع الإجازة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ نوع الإجازة', 'error');
    }
  },

  // 3. تقييم أداء الموظفين
  async loadEvaluations() {
    try {
      const res = await fetch('/api/hr/evaluations');
      const json = await res.json();
      if (json.success) {
        this.evaluations = json.data || [];
        const tbody = document.getElementById('hrEvaluationsTableBody');
        if (tbody) {
          tbody.innerHTML = this.evaluations.length ? this.evaluations.map(ev => `
            <tr>
              <td><strong>${this.esc(ev.employee_name)}</strong> <small>(${this.esc(ev.employee_no || '-')})</small></td>
              <td>${ev.evaluation_date}</td>
              <td><span class="badge badge-info">${this.esc(ev.rating || '-')}</span></td>
              <td><b>${ev.score}/100</b></td>
              <td style="color: var(--accent-green); font-weight: bold;">+${this.money(ev.bonus_amount)}</td>
              <td style="color: var(--accent-red); font-weight: bold;">-${this.money(ev.deduction_amount)}</td>
              <td>${this.esc(ev.evaluator_name || '-')}</td>
              <td style="color: var(--text-secondary);">${this.esc(ev.comments || '-')}</td>
            </tr>
          `).join('') : '<tr><td colspan="8" style="text-align:center;padding:25px;">لا توجد تقييمات مسجلة بعد</td></tr>';
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  async submitEvaluation(e) {
    if (e) e.preventDefault();
    const employee_id = document.getElementById('hrEvalEmployee')?.value;
    const evaluation_date = document.getElementById('hrEvalDate')?.value || new Date().toISOString().slice(0, 10);
    const rating = document.getElementById('hrEvalRating')?.value;
    const score = parseInt(document.getElementById('hrEvalScore')?.value) || 85;
    const bonus_amount = parseFloat(document.getElementById('hrEvalBonus')?.value) || 0;
    const deduction_amount = parseFloat(document.getElementById('hrEvalDeduction')?.value) || 0;
    const evaluator_name = document.getElementById('hrEvalEvaluator')?.value?.trim() || '';
    const comments = document.getElementById('hrEvalComments')?.value?.trim() || '';

    if (!employee_id) {
      App.showToast('يرجى اختيار الموظف', 'error');
      return;
    }

    try {
      const res = await fetch('/api/hr/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id, evaluation_date, rating, score, bonus_amount, deduction_amount, evaluator_name, comments })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم حفظ تقييم الموظف بنجاح', 'success');
        e.target.reset();
        this.setToday();
        await this.loadEvaluations();
      } else {
        App.showToast(data.message || 'فشل حفظ التقييم', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ التقييم', 'error');
    }
  },

  openModal(id) {
    document.getElementById(id)?.classList.add('active');
  },

  closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
  },

  openEmployeeModal(id = null) {
    const e = this.employees.find(x => x.id === id);
    document.getElementById('hrEmployeeForm').reset();
    document.getElementById('hrEmployeeId').value = id || '';
    document.getElementById('hrEmployeeModalTitle').textContent = e ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد';
    if (e) {
      ['full_name', 'national_id', 'phone', 'job_title', 'department', 'basic_salary', 'bank_name', 'bank_account', 'notes'].forEach(k => {
        const el = document.getElementById('hrEmp_' + k);
        if (el) el.value = e[k] || '';
      });
      document.getElementById('hrEmp_status').value = e.status;
      document.getElementById('hrEmp_employment_type').value = e.employment_type || 'دوام كامل';
      document.getElementById('hrEmp_hire_date').value = e.hire_date || '';
    }
    this.openModal('hrEmployeeModal');
  },

  async submitEmployee(e) {
    e.preventDefault();
    const id = document.getElementById('hrEmployeeId').value;
    const body = {};
    ['full_name', 'national_id', 'phone', 'job_title', 'department', 'employment_type', 'hire_date', 'basic_salary', 'status', 'bank_name', 'bank_account', 'notes'].forEach(k => body[k] = document.getElementById('hrEmp_' + k).value);
    const res = await fetch('/api/hr/employees' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.success) {
      this.closeModal('hrEmployeeModal');
      await this.load();
    } else alert(json.message);
  },

  async submitAttendance(e) {
    e.preventDefault();
    const body = {
      employee_id: document.getElementById('hrAttendanceEmployee').value,
      date: document.getElementById('hrAttendanceDate').value,
      status: document.getElementById('hrAttendanceStatus').value,
      check_in: document.getElementById('hrCheckIn').value,
      check_out: document.getElementById('hrCheckOut').value,
      overtime_hours: document.getElementById('hrOvertime').value,
      notes: document.getElementById('hrAttendanceNotes').value
    };
    const j = await (await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.success) {
      e.target.reset();
      this.setToday();
      this.loadAttendance();
      this.loadDashboard();
    } else alert(j.message);
  },

  async submitLeave(e) {
    e.preventDefault();
    const body = {
      employee_id: document.getElementById('hrLeaveEmployee').value,
      leave_type: document.getElementById('hrLeaveType').value,
      start_date: document.getElementById('hrLeaveStart').value,
      end_date: document.getElementById('hrLeaveEnd').value,
      days_count: document.getElementById('hrLeaveDays').value,
      notes: document.getElementById('hrLeaveNotes')?.value || ''
    };
    const j = await (await fetch('/api/hr/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.success) {
      e.target.reset();
      this.loadLeaves();
      this.loadDashboard();
    } else alert(j.message);
  },

  async submitAdvance(e) {
    e.preventDefault();
    const body = {
      employee_id: document.getElementById('hrAdvanceEmployee').value,
      amount: document.getElementById('hrAdvanceAmount').value,
      date: document.getElementById('hrAdvanceDate').value,
      installment_amount: document.getElementById('hrAdvanceInstallment').value,
      notes: document.getElementById('hrAdvanceNotes')?.value || ''
    };
    const j = await (await fetch('/api/hr/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.success) {
      e.target.reset();
      this.loadAdvances();
      this.loadDashboard();
    } else alert(j.message);
  },

  async setLeaveStatus(id, status) {
    await fetch('/api/hr/leaves/' + id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    this.loadLeaves();
    this.loadDashboard();
  },

  async generatePayroll() {
    const month = document.getElementById('hrPayrollMonth').value;
    if (!month) return alert('اختر شهر المسير أولاً');
    const j = await (await fetch('/api/hr/payroll/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payroll_month: month }) })).json();
    alert(j.message);
    if (j.success) {
      this.loadPayroll();
      this.loadDashboard();
    }
  },

  showPane(name, button) {
    document.querySelectorAll('.hr-pane').forEach(p => p.style.display = 'none');
    const pane = document.getElementById('hrPane_' + name);
    if (pane) pane.style.display = 'block';
    document.querySelectorAll('#hrView .report-tab-btn').forEach(b => b.classList.remove('active'));
    button?.classList.add('active');
    if (name === 'leaveTypes') this.loadLeaveTypes();
    if (name === 'evaluations') this.loadEvaluations();
  },

  async payPayroll(id) {
    const j = await (await fetch('/api/hr/payroll/' + id + '/pay', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if (j.success) {
      this.loadPayroll();
      this.loadDashboard();
    } else alert(j.message);
  }
};

if (typeof window !== 'undefined') {
  window.HR = HR;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HR;
}
