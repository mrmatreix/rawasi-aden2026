/**
 * إدارة العمليات المحاسبية، السندات، حركة الصندوق، والعهد - شركة رواسي عدن
 */

const Accounting = {
  clients: [],
  suppliers: [],
  projects: [],
  accounts: [], // الحسابات الطرفية التحليلية الصالحة للقيود والسندات (Level 3+ Leaf)
  allAccounts: [], // كافة حسابات الدليل الشجري بما فيها الحسابات التجميعية
  costCenters: [],
  currencies: [],
  employees: [],
  openCustodies: [],
  journalEntries: [],
  currentJournalEntry: null,
  activeJournalTab: 'journalEntries',
  nextNumbers: null,

  async init() {
    await this.loadDropdowns();
    await this.loadCashMovement();
    await this.loadRecentCustodySummary();
  },

  _targetClientSelectId: null,
  _targetSupplierSelectId: null,

  async loadDropdowns() {
    try {
      const [cRes, sRes, pRes, aAllRes, aUsableRes, ccRes, empRes, currRes, bRes] = await Promise.all([
        fetch('/api/clients').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/suppliers').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/projects').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/accounting/accounts').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/accounting/accounts?usable_only=true').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/accounting/cost-centers').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/hr/employees').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/accounting/currencies').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/bank-reconciliation/accounts').then(r => r.json()).catch(() => ({ success: false }))
      ]);

      if (cRes.success) {
        this.clients = cRes.data;
        this.populateSelect('rcClientSelect', cRes.data, 'name');
        this.populateSelect('modalRcClientSelect', cRes.data, 'name');
        this.populateSelect('statementClientSelect', cRes.data, 'name');
        this.populateSelect('projClientSelect', cRes.data, 'name');
        const dl = document.getElementById('modalRcClientDatalist');
        if (dl) {
          dl.innerHTML = (cRes.data || []).map(c => `<option value="${c.name}">${c.phone ? 'هاتف: ' + c.phone : ''}</option>`).join('');
        }
      }
      if (sRes.success) {
        this.suppliers = sRes.data;
        this.populateSelect('expSupplierSelect', sRes.data, 'name');
        this.populateSelect('modalExpSupplierSelect', sRes.data, 'name');
        const dl = document.getElementById('modalExpSupplierDatalist');
        if (dl) {
          dl.innerHTML = (sRes.data || []).map(s => `<option value="${s.name}">${s.phone ? 'هاتف: ' + s.phone : ''}</option>`).join('');
        }
      }
      if (pRes.success) {
        this.projects = pRes.data;
        this.populateSelect('rcProjectSelect', pRes.data, 'name');
        this.populateSelect('modalRcProjectSelect', pRes.data, 'name');
        this.populateSelect('expProjectSelect', pRes.data, 'name');
      }
      if (currRes.success) {
        this.currencies = currRes.data || [];
      }
      if (aAllRes.success) {
        this.allAccounts = aAllRes.data || [];
        this.populateParentSelects();
      }
      if (aUsableRes.success && Array.isArray(aUsableRes.data) && aUsableRes.data.length > 0) {
        this.accounts = aUsableRes.data;
      } else if (aAllRes.success && Array.isArray(aAllRes.data) && aAllRes.data.length > 0) {
        // احتياطي في حال عدم تطبيق الفلترة
        this.accounts = aAllRes.data.filter(a => (a.status === 'active' || !a.status) && (a.children_count === 0 || !a.children_count) && (a.is_posting === 1 || a.level === 5 || a.is_leaf));
      }

      if (ccRes.success) {
        this.costCenters = ccRes.data;
      }
      if (empRes.success) {
        this.employees = empRes.data;
        this.populateSelectCustom('custodyEmployeeSelect', empRes.data, e => `${e.name} (${e.employee_no || e.role || 'موظف'})`);
        this.populateSelectCustom('modalCustodyEmployeeSelect', empRes.data, e => `${e.name} (${e.employee_no || e.role || 'موظف'})`);
      }
      if (bRes && bRes.success && Array.isArray(bRes.data)) {
        this.bankAccounts = bRes.data;
        const formatBank = b => `${b.bank_name} - ${b.account_number} (${b.currency || 'ر.ي'})`;
        this.populateSelectCustom('modalExpBankAccountSelect', this.bankAccounts, formatBank);
        this.populateSelectCustom('modalRcBankAccountSelect', this.bankAccounts, formatBank);
        this.populateSelectCustom('expBankAccountSelect', this.bankAccounts, formatBank);
        this.populateSelectCustom('rcBankAccountSelect', this.bankAccounts, formatBank);
      }

      // تحديث كافة القوائم المنسدلة للحسابات ومراكز التكلفة فوراً
      this.refreshAllAccountSelects();
    } catch (e) {
      console.error('Error loading dropdowns:', e);
    }
  },

  refreshAllAccountSelects() {
    if (this.accounts && this.accounts.length) {
      const formatLeafAcc = a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`;
      this.populateSelectCustom('rcAccountSelect', this.accounts, formatLeafAcc);
      this.populateSelectCustom('modalRcAccountSelect', this.accounts, formatLeafAcc);
      this.populateSelectCustom('expAccountSelect', this.accounts, formatLeafAcc);
      this.populateSelectCustom('modalExpAccountSelect', this.accounts, formatLeafAcc);
      this.populateSelectCustom('modalCustodyAccountSelect', this.accounts, formatLeafAcc);
      this.populateSelectCustom('quickCustodyAccountSelect', this.accounts, formatLeafAcc);

      // تحديث أي حقول أسطر قيد يومية مفتوحة حالياً إذا كانت خالية من الخيارات
      const jeAccSelects = document.querySelectorAll('#journalLinesTableBody .je-line-account');
      if (jeAccSelects && jeAccSelects.length > 0) {
        jeAccSelects.forEach(sel => {
          if (sel.options.length <= 1) {
            const currentVal = sel.value;
            const optionsHtml = this.accounts.map(a => 
              `<option value="${a.id}" data-code="${a.code || a.account_code || ''}" data-type="${a.type || a.account_type || ''}" ${currentVal == a.id ? 'selected' : ''}>${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || ''})</option>`
            ).join('');
            sel.innerHTML = `<option value="">اختر الحساب...</option>` + optionsHtml;
            if (currentVal) sel.value = currentVal;
          }
        });
      }
    }

    if (this.costCenters && this.costCenters.length) {
      this.populateSelectCustom('rcCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
      this.populateSelectCustom('modalRcCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
      this.populateSelectCustom('expCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
      this.populateSelectCustom('modalExpCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
      this.populateSelectCustom('modalJeCostCenter', this.costCenters, cc => `${cc.code} - ${cc.name}`);
    }
  },

  populateSelect(elementId, items, displayField) {
    const el = document.getElementById(elementId);
    if (!el || !Array.isArray(items)) return;
    const defaultOption = el.options[0] ? el.options[0].outerHTML : '<option value="">اختر...</option>';
    el.innerHTML = defaultOption + items.map(item => `<option value="${item.id}">${item[displayField]}</option>`).join('');
  },

  populateSelectCustom(elementId, items, formatFn) {
    const el = document.getElementById(elementId);
    if (!el || !Array.isArray(items)) return;
    const defaultOption = el.options[0] ? el.options[0].outerHTML : '<option value="">اختر...</option>';
    el.innerHTML = defaultOption + items.map(item => `<option value="${item.id}">${formatFn(item)}</option>`).join('');
  },

  async onClientInputChange(val) {
    const hid = document.getElementById('modalRcClientSelect');
    if (!val) {
      if (hid) hid.value = '';
      this.populateReceiptContractsAndBills([]);
      return;
    }

    const norm = (s) => (s || '').trim().toLowerCase()
      .replace(/[إأآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F]/g, '');

    const normVal = norm(val);
    const match = (this.clients || []).find(c => 
      String(c.id) === String(val) || 
      c.name === val || 
      norm(c.name) === normVal ||
      (normVal.length >= 3 && norm(c.name).includes(normVal)) ||
      (normVal.length >= 3 && normVal.includes(norm(c.name)))
    );

    const clientId = match ? match.id : null;
    if (hid) hid.value = clientId || '';

    if (clientId) {
      await this.loadClientHierarchyForReceipt(clientId);
      // إذا كان للعميل مشروع مسجل ولم يتم اختيار مشروع بعد، نختاره تلقائياً
      const prjSelect = document.getElementById('modalRcProjectSelect');
      if (prjSelect && (!prjSelect.value || prjSelect.value === '')) {
        const clientProject = (this.projects || []).find(p => p.client_id == clientId);
        if (clientProject) prjSelect.value = clientProject.id;
      }
    } else {
      this.populateReceiptContractsAndBills([]);
    }
  },

  async loadClientHierarchyForReceipt(clientId) {
    try {
      const [contractsRes, billsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/contracts`).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/billing?client_id=${clientId}`).then(r => r.json()).catch(() => ({ success: false }))
      ]);

      this.receiptClientContracts = contractsRes.success ? (contractsRes.data || []) : [];
      // تصفية المستخلصات المستحقة (غير المسددة بالكامل)
      const allBills = billsRes.success ? (billsRes.data || []) : [];
      this.receiptClientBills = allBills.filter(b => {
        const net = Number(b.net_amount || b.amount || 0);
        const paid = Number(b.paid_amount || 0);
        const rem = Number(b.remaining_amount !== undefined ? b.remaining_amount : (net - paid));
        return b.status !== 'ملغي' && (b.payment_status !== 'paid' || rem > 0);
      });

      this.populateReceiptContractsAndBills(this.receiptClientContracts, this.receiptClientBills);
    } catch (err) {
      console.error('Error loading client hierarchy for receipt:', err);
    }
  },

  populateReceiptContractsAndBills(contracts = [], bills = []) {
    const cSelect = document.getElementById('modalRcContractSelect');
    if (cSelect) {
      const currVal = cSelect.value;
      cSelect.innerHTML = '<option value="">بدون عقد محدد...</option>' + 
        contracts.map(c => `<option value="${c.id}" ${currVal == c.id ? 'selected' : ''}>عقد ${c.contract_no || c.id} (قيمة: ${App.formatNumber(c.contract_value)})</option>`).join('');
    }

    const bSelect = document.getElementById('modalRcBillSelect');
    const hint = document.getElementById('modalRcBillRemainingHint');
    if (bSelect) {
      if (bills.length === 0) {
        bSelect.innerHTML = '<option value="">لا توجد مستخلصات غير مسددة لهذا العميل / المشروع</option>';
        if (hint) hint.style.display = 'none';
      } else {
        const currVal = bSelect.value;
        bSelect.innerHTML = '<option value="">اختر المستخلص لسداده وتحديث رصيد العميل آلياً...</option>' +
          bills.map(b => {
            const net = Number(b.net_amount || b.amount || 0);
            const paid = Number(b.paid_amount || 0);
            const rem = Number(b.remaining_amount !== undefined ? b.remaining_amount : Math.max(0, net - paid));
            return `<option value="${b.id}" data-project="${b.project_id || ''}" data-contract="${b.contract_id || ''}" data-rem="${rem}" data-billno="${b.bill_no}" ${currVal == b.id ? 'selected' : ''}>مستخلص ${b.bill_no} - متبقي: ${App.formatNumber(rem)} ر.ي (${b.project_name || 'مشروع'})</option>`;
          }).join('');
        if (hint) {
          hint.innerText = `💡 يوجد ${bills.length} مستخلصات مستحقة للتحصيل على هذا العميل / المشروع`;
          hint.style.display = 'block';
        }
      }
    }
  },

  onReceiptCategoryChange(category) {
    const billRow = document.getElementById('modalRcBillRow');
    const notes = document.getElementById('modalRcNotes');
    if (category === 'advance_payment') {
      if (billRow) billRow.style.display = 'none';
      if (notes && !notes.value) notes.value = 'دفعة مقدمة على العقد المتفق عليه';
    } else if (category === 'retention_release') {
      if (billRow) billRow.style.display = 'none';
      if (notes && !notes.value) notes.value = 'إفراج عن محتجز ضمان أعمال';
    } else {
      if (billRow) billRow.style.display = 'block';
    }
  },

  async onReceiptProjectChange(projectId) {
    if (!projectId) {
      const clientId = document.getElementById('modalRcClientSelect')?.value;
      if (clientId) {
        await this.loadClientHierarchyForReceipt(clientId);
      }
      return;
    }

    // 1. مزامنة العميل التابع للمشروع تلقائياً
    const project = (this.projects || []).find(p => p.id == projectId);
    if (project && project.client_id) {
      const client = (this.clients || []).find(c => c.id == project.client_id);
      if (client) {
        const cInput = document.getElementById('modalRcClientInput');
        const cHid = document.getElementById('modalRcClientSelect');
        if (cInput && (!cInput.value || cInput.value !== client.name)) {
          cInput.value = client.name;
        }
        if (cHid) cHid.value = client.id;
      }
    }

    // 2. جلب عقود ومستخلصات هذا المشروع تحديداً وربط السلسلة المالية
    await this.loadProjectHierarchyForReceipt(projectId);
  },

  async loadProjectHierarchyForReceipt(projectId) {
    try {
      const [contractsRes, billsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/contracts`).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/billing?project_id=${projectId}`).then(r => r.json()).catch(() => ({ success: false }))
      ]);

      let contracts = contractsRes.success ? (contractsRes.data || []) : [];
      let bills = billsRes.success ? (billsRes.data || []) : [];

      if (contracts.length === 0 && this.receiptClientContracts) {
        contracts = this.receiptClientContracts.filter(c => c.project_id == projectId);
      }
      if (bills.length === 0 && this.receiptClientBills) {
        bills = this.receiptClientBills.filter(b => b.project_id == projectId);
      }

      this.receiptClientContracts = contracts;
      this.receiptClientBills = bills.filter(b => {
        const net = Number(b.net_amount || b.amount || 0);
        const paid = Number(b.paid_amount || 0);
        const rem = Number(b.remaining_amount !== undefined ? b.remaining_amount : (net - paid));
        return b.status !== 'ملغي' && (b.payment_status !== 'paid' || rem > 0);
      });

      this.populateReceiptContractsAndBills(this.receiptClientContracts, this.receiptClientBills);
    } catch (err) {
      console.error('Error loading project hierarchy for receipt:', err);
    }
  },

  onReceiptContractChange(contractId) {
    if (!contractId) return;
    const contract = (this.receiptClientContracts || []).find(c => c.id == contractId);
    if (contract && contract.project_id) {
      const prjSelect = document.getElementById('modalRcProjectSelect');
      if (prjSelect) prjSelect.value = contract.project_id;
    }
  },

  onReceiptBillChange(billId) {
    if (!billId) return;
    const bill = (this.receiptClientBills || []).find(b => b.id == billId);
    if (!bill) return;

    // ضبط المشروع المرتبط تلقائياً
    if (bill.project_id) {
      const prjSelect = document.getElementById('modalRcProjectSelect');
      if (prjSelect) prjSelect.value = bill.project_id;
    }

    // ضبط العقد المرتبط تلقائياً
    if (bill.contract_id) {
      const cSelect = document.getElementById('modalRcContractSelect');
      if (cSelect) cSelect.value = bill.contract_id;
    }

    // اقتراح المبلغ المتبقي من المستخلص
    const net = Number(bill.net_amount || bill.amount || 0);
    const paid = Number(bill.paid_amount || 0);
    const rem = Number(bill.remaining_amount !== undefined ? bill.remaining_amount : Math.max(0, net - paid));

    const amtInput = document.getElementById('modalRcAmount');
    if (amtInput && (!amtInput.value || Number(amtInput.value) <= 0)) {
      amtInput.value = rem;
      this.calcReceiptLocalAmount();
    }

    // كتابة البيان التلقائي
    const notes = document.getElementById('modalRcNotes');
    if (notes && (!notes.value || notes.value.startsWith('سداد مستخلص'))) {
      notes.value = `سداد مستخلص أعمال رقم ${bill.bill_no} لمشروع ${bill.project_name || ''}`;
    }

    const hint = document.getElementById('modalRcBillRemainingHint');
    if (hint) {
      hint.innerHTML = `<span style="color: var(--gold-light); font-weight: bold;">المتبقي من هذا المستخلص: ${App.formatNumber(rem)} ر.ي</span> (إجمالي المستخلص: ${App.formatNumber(net)} ر.ي)`;
      hint.style.display = 'block';
    }
  },

  onSupplierInputChange(val) {
    if (!val) {
      const hid = document.getElementById('modalExpSupplierSelect');
      if (hid) hid.value = '';
      return;
    }
    const match = (this.suppliers || []).find(s => s.name === val || String(s.id) === val);
    const hid = document.getElementById('modalExpSupplierSelect');
    if (hid) hid.value = match ? match.id : '';
  },

  _currentCashFilter: 'الكل',
  switchCashFilter(type, btn) {
    this._currentCashFilter = type;
    const tabs = ['tabCashAll', 'tabCashCash', 'tabCashBank'];
    tabs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
    if (window.App && App.loadCashTable) {
      App.loadCashTable(type);
    }
  },

  async exportCashMovementExcel() {
    try {
      App.showToast('جاري تصدير كشف حركة الصندوق والبنك...', 'info');
      const activeType = this._currentCashFilter || 'الكل';
      let url = '/api/accounting/cash-movements?all=true';
      if (activeType !== 'الكل') {
        url += '&type=' + encodeURIComponent(activeType);
      }
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        App.showToast('لا توجد حركات مسجلة للتصدير', 'warning');
        return;
      }
      const list = json.data;
      const summary = json.summary || {};
      const { companyName, phone, slogan } = (typeof ExcelExporter !== 'undefined') 
        ? ExcelExporter.getCompanyInfo() 
        : { companyName: 'شركة رواسي عدن للهندسة والمقاولات', phone: '773413937', slogan: 'نبني الحاضر لنستثمر المستقبل' };

      const htmlBody = `
        <table>
          <tr><td colspan="8" class="hdr-company">${companyName}</td></tr>
          <tr><td colspan="8" class="hdr-title">كشف حركة الصندوق والبنك والتدفقات النقدية (${activeType})</td></tr>
          <tr><td colspan="8" class="hdr-meta">تاريخ التقرير: ${new Date().toLocaleDateString('ar-YE')} | الهاتف: ${phone} | ${slogan}</td></tr>
          <tr><td colspan="8" style="height: 10px; border: none;"></td></tr>
          <thead>
            <tr>
              <th style="background:#1e293b; color:#fff;">التاريخ</th>
              <th style="background:#1e293b; color:#fff;">نوع الحركة</th>
              <th style="background:#1e293b; color:#fff;">طريقة الدفع / المرجع</th>
              <th style="background:#1e293b; color:#fff;">الرصيد السابق</th>
              <th style="background:#1e293b; color:#fff;">المقبوضات (+)</th>
              <th style="background:#1e293b; color:#fff;">المدفوعات (-)</th>
              <th style="background:#1e293b; color:#fff;">الرصيد بعد الحركة</th>
              <th style="background:#1e293b; color:#fff;">البيان والتفاصيل</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((m, idx) => `
              <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
                <td style="mso-number-format:'\\@'; text-align:center;">${m.date}</td>
                <td style="mso-number-format:'\\@'; text-align:center; font-weight:bold;">${m.movement_type || 'نقدي'}</td>
                <td style="mso-number-format:'\\@'; text-align:center;">${m.payment_method || (m.reference_no ? m.reference_no : '-')}</td>
                <td class="num">${Number(m.previous_balance || 0).toLocaleString('en-US')}</td>
                <td class="currency" style="color:#047857;">${m.cash_in ? Number(m.cash_in).toLocaleString('en-US') : '0'}</td>
                <td class="currency" style="color:#b91c1c;">${m.cash_out ? Number(m.cash_out).toLocaleString('en-US') : '0'}</td>
                <td class="currency" style="font-weight:bold; color:#0f2744;">${Number(m.current_balance || 0).toLocaleString('en-US')}</td>
                <td style="text-align:right;">${m.notes || '-'}</td>
              </tr>
            `).join('')}
            <tr class="row-total">
              <td colspan="4" style="text-align:center; font-weight:bold;">الإجماليات</td>
              <td class="currency" style="color:#047857; font-weight:bold;">${Number(summary.total_cash_in || 0).toLocaleString('en-US')} ر.ي</td>
              <td class="currency" style="color:#b91c1c; font-weight:bold;">${Number(summary.total_cash_out || 0).toLocaleString('en-US')} ر.ي</td>
              <td class="currency" style="font-weight:bold; font-size:11pt; color:#0f2744;">${Number(summary.current_balance || 0).toLocaleString('en-US')} ر.ي</td>
              <td style="text-align:center; font-weight:bold;">صافي الرصيد الحالي</td>
            </tr>
          </tbody>
        </table>
      `;
      if (typeof ExcelExporter !== 'undefined') {
        ExcelExporter.download(htmlBody, `حركة_الصندوق_والبنك_${activeType}_${new Date().toISOString().split('T')[0]}`, 'حركة الصندوق والبنك');
      }
      App.showToast('تم تصدير كشف الحركة لـ Excel بنجاح', 'success');
    } catch (e) {
      App.showToast('خطأ أثناء تصدير حركة الصندوق: ' + e.message, 'error');
    }
  },

  async printCashMovement() {
    try {
      const activeType = this._currentCashFilter || 'الكل';
      let url = '/api/accounting/cash-movements?all=true';
      if (activeType !== 'الكل') {
        url += '&type=' + encodeURIComponent(activeType);
      }
      const res = await fetch(url);
      const json = await res.json();
      const list = (json.success && json.data) ? json.data : [];
      const summary = json.summary || {};

      const printWin = window.open('', '_blank');
      if (!printWin) {
        App.showToast('يرجى السماح بالنوافذ المنبثقة للطباعة', 'warning');
        return;
      }
      printWin.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <title>كشف حركة الصندوق والبنك والتدفقات النقدية</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; direction: rtl; margin: 20px; color: #0f172a; }
            .header { text-align: center; border-bottom: 2px solid #0f2744; padding-bottom: 12px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 20px; color: #0f2744; }
            .header h3 { margin: 5px 0; font-size: 16px; color: #b45309; }
            .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
            th { background: #1e293b; color: #fff; padding: 8px 6px; border: 1px solid #475569; text-align: center; }
            td { padding: 6px; border: 1px solid #cbd5e1; text-align: right; }
            .text-center { text-align: center; }
            .text-left { text-align: left; }
            .green { color: #047857; font-weight: bold; }
            .red { color: #b91c1c; font-weight: bold; }
            .gold { color: #b45309; font-weight: bold; }
            .summary-box { display: flex; justify-content: space-around; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin-top: 20px; font-weight: bold; }
            .sig-area { display: flex; justify-content: space-between; margin-top: 50px; font-weight: bold; padding: 0 40px; }
            @media print {
              @page { size: A4 landscape; margin: 12mm; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>شركة رواسي عدن للهندسة والمقاولات</h1>
            <h3>كشف حركة الصندوق والبنك والتدفقات النقدية (${activeType})</h3>
            <div class="meta">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-YE')} | كشف الحساب الرسمي المعتمد</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>التاريخ</th>
                <th>نوع الحركة</th>
                <th>طريقة الدفع / المرجع</th>
                <th>الرصيد السابق</th>
                <th>المقبوضات (+)</th>
                <th>المدفوعات (-)</th>
                <th>الرصيد بعد الحركة</th>
                <th>البيان والتفاصيل</th>
              </tr>
            </thead>
            <tbody>
              ${list.map((m, i) => `
                <tr>
                  <td class="text-center">${i + 1}</td>
                  <td class="text-center">${m.date}</td>
                  <td class="text-center"><strong>${m.movement_type || 'نقدي'}</strong></td>
                  <td class="text-center">${m.payment_method || (m.reference_no || '-')}</td>
                  <td class="text-left">${Number(m.previous_balance || 0).toLocaleString('en-US')}</td>
                  <td class="text-left green">${m.cash_in ? '+' + Number(m.cash_in).toLocaleString('en-US') : '-'}</td>
                  <td class="text-left red">${m.cash_out ? '-' + Number(m.cash_out).toLocaleString('en-US') : '-'}</td>
                  <td class="text-left gold">${Number(m.current_balance || 0).toLocaleString('en-US')}</td>
                  <td>${m.notes || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="summary-box">
            <div>إجمالي المقبوضات: <span class="green">${Number(summary.total_cash_in || 0).toLocaleString('en-US')} ر.ي</span></div>
            <div>إجمالي المدفوعات: <span class="red">${Number(summary.total_cash_out || 0).toLocaleString('en-US')} ر.ي</span></div>
            <div>الرصيد النهائي: <span class="gold">${Number(summary.current_balance || 0).toLocaleString('en-US')} ر.ي</span></div>
          </div>
          <div class="sig-area">
            <div>أمين الصندوق / الخزينة: .........................</div>
            <div>المحاسب المالي: .........................</div>
            <div>المدير المالي والاعتماد: .........................</div>
          </div>
          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
        </html>
      `);
      printWin.document.close();
    } catch (e) {
      App.showToast('خطأ أثناء تجهيز الطباعة: ' + e.message, 'error');
    }
  },

  // إظهار/إخفاء وضبط حقول الحساب المالي والمرجع بناء على طريقة الدفع
  handlePaymentMethodChange(selectId, targetRowId) {
    const el = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
    const row = document.getElementById(targetRowId);
    if (!el || !row) return;
    const val = el.value;
    const isRc = targetRowId.includes('Rc');
    const faSelectId = isRc ? 'modalRcFinancialAccountSelect' : 'modalExpFinancialAccountSelect';
    const faHintId = isRc ? 'modalRcFaHint' : 'modalExpFaHint';
    const checkNoInput = isRc ? document.getElementById('modalRcCheckNo') : document.getElementById('modalExpCheckNo');
    const refLabel = isRc ? document.getElementById('modalRcRefLabel') : document.getElementById('modalExpRefLabel');

    // تحديث قائمة الحسابات المالية المناسبة لطريقة الدفع
    this.updateFinancialAccountsDropdown(faSelectId, val, faHintId);

    // ضبط حقل المرجع والشيك
    const isCheck = val === 'شيك' || val === 'CHEQUE';
    const isBank = val === 'تحويل بنكي' || val === 'BANK_TRANSFER';
    const isCard = val === 'CREDIT_CARD' || val === 'DEBIT_CARD' || val === 'ONLINE_GATEWAY' || val === 'POS';

    if (refLabel) {
      if (isCheck) refLabel.innerHTML = 'رقم الشيك البنكي <span style="color: var(--accent-red);">*</span>';
      else if (isBank) refLabel.innerHTML = 'المرجع / رقم الحوالة البنكية <span style="color: var(--accent-red);">*</span>';
      else if (isCard) refLabel.innerHTML = 'رقم المعاملة / التفويض (Txn Ref)';
      else refLabel.innerHTML = 'المرجع / رقم السند الورقي (اختياري)';
    }

    if (checkNoInput) {
      if (isCheck) checkNoInput.placeholder = 'أدخل رقم الشيك الصادر/الوارد';
      else if (isBank) checkNoInput.placeholder = 'رقم الحوالة البنكية أو الإشعار';
      else if (isCard) checkNoInput.placeholder = 'رقم تفويض أو مرجع بوابة الدفع';
      else checkNoInput.placeholder = 'رقم الإشعار أو المرجع إن وجد';
    }
  },

  onFinancialAccountChange(faId, hintId) {
    const hint = document.getElementById(hintId);
    if (!hint) return;
    if (!faId) {
      hint.innerHTML = '';
      return;
    }
    const fa = (this.financialAccounts || []).find(f => String(f.id) === String(faId));
    if (fa) {
      hint.innerHTML = `💡 الحساب المحاسبي المرتبط: <strong style="color: var(--gold-light);">${fa.coa_code || ''} - ${fa.coa_name || ''}</strong> (حساب فرعي أخير)`;
    } else {
      hint.innerHTML = '';
    }
  },

  updateFinancialAccountsDropdown(selectId, methodVal, hintId = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    let targetType = 'cash';
    const m = (methodVal || '').toUpperCase();
    if (m === 'BANK_TRANSFER' || m === 'تحويل بنكي' || m === 'CHEQUE' || m === 'شيك') {
      targetType = 'bank';
    } else if (m === 'CREDIT_CARD' || m === 'DEBIT_CARD' || m === 'ONLINE_GATEWAY' || m === 'POS') {
      targetType = 'gateway';
    } else if (m === 'WALLET' || m === 'محفظة إلكترونية') {
      targetType = 'wallet';
    } else {
      targetType = 'cash';
    }

    const allFa = this.financialAccounts || [];
    let filtered = allFa.filter(f => f.type === targetType);
    if (filtered.length === 0) filtered = allFa;

    select.innerHTML = '<option value="">اختر الحساب المالي...</option>' +
      filtered.map((f, idx) => `<option value="${f.id}" ${idx === 0 ? 'selected' : ''}>${f.name} (${f.type})</option>`).join('');

    if (filtered.length > 0 && hintId) {
      this.onFinancialAccountChange(filtered[0].id, hintId);
    }
  },

  // التحكم بنوع العهدة (صرف عهدة أو تصفية عهدة)
  handleCustodyTypeChange(selectId, relatedRowId) {
    const el = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
    const row = document.getElementById(relatedRowId);
    if (!el || !row) return;
    const isLiquidation = el.value === 'تصفية عهدة';
    row.style.display = isLiquidation ? 'block' : 'none';

    const isQuick = relatedRowId.includes('quick');
    const amtLabel = document.getElementById(isQuick ? 'quickCustodyAmountLabel' : 'modalCustodyAmountLabel');
    if (amtLabel) {
      amtLabel.textContent = isLiquidation ? 'المبلغ المراد تصفيته *' : 'إجمالي العهدة *';
    }

    // إذا تم اختيار التصفية، جلب العهد النشطة للموظف المختار
    const empSelectId = isQuick ? 'custodyEmployeeSelect' : 'modalCustodyEmployeeSelect';
    const relSelectId = isQuick ? 'custodyRelatedSelect' : 'modalCustodyRelatedSelect';
    if (isLiquidation) {
      this.onCustodyEmployeeChange(empSelectId, relSelectId);
    }
  },

  // عند تغيير الموظف في العهد: جلب عهده النشطة المفتوحة للتصفية
  async onCustodyEmployeeChange(empSelectId, relatedSelectId) {
    const empSelect = document.getElementById(empSelectId);
    const relSelect = document.getElementById(relatedSelectId);
    if (!empSelect) return;
    const empId = empSelect.value;
    const isQuick = empSelectId === 'custodyEmployeeSelect';

    // مزامنة حقل الاسم النصي إن وجد
    const empObj = this.employees.find(e => String(e.id) === String(empId));
    if (empObj) {
      const nameInput = document.getElementById(isQuick ? 'custodyEmpName' : 'modalCustodyEmpName');
      if (nameInput) nameInput.value = empObj.name;
    }

    if (!relSelect) return;
    relSelect.innerHTML = '<option value="">جاري جلب العهد المفتوحة للتصفية...</option>';

    try {
      const res = await fetch(`/api/accounting/open-custodies${empId ? `?employee_id=${empId}` : ''}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        this.openCustodies = data.data;
        if (data.data.length === 0) {
          relSelect.innerHTML = '<option value="">لا توجد عهد نشطة متبقية لهذا الموظف</option>';
        } else {
          relSelect.innerHTML = '<option value="">اختر العهدة الأصلية المراد تصفيتها...</option>' +
            data.data.map(c => `
              <option value="${c.id}" data-rem="${c.remaining_amount}" data-total="${c.total_amount}" data-no="${c.custody_no || ('CST-' + c.id)}">
                ${c.custody_no || ('CST-' + c.id)} - إجمالي: ${App.formatNumber(c.total_amount)} | متبقي: ${App.formatNumber(c.remaining_amount)} ${c.currency || 'ر.ي'} (${c.date})
              </option>
            `).join('');
        }
      } else {
        relSelect.innerHTML = '<option value="">لا توجد عهد نشطة</option>';
      }
    } catch (e) {
      console.error('Error fetching open custodies:', e);
      relSelect.innerHTML = '<option value="">فشل جلب العهد</option>';
    }
  },

  // عند اختيار عهدة أصلية للتصفية
  onRelatedCustodySelect(selectId, totalAmountId, spentAmountId) {
    const selectEl = document.getElementById(selectId);
    const totalEl = document.getElementById(totalAmountId);
    if (!selectEl || !totalEl) return;
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    if (!selectedOpt || !selectedOpt.value) return;

    const rem = Number(selectedOpt.getAttribute('data-rem')) || 0;
    totalEl.value = rem;
    totalEl.setAttribute('max', rem);
    App.showToast(`الرصيد المتبقي المتاح للتصفية في هذه العهدة هو: ${App.formatNumber(rem)}`, 'info');
  },

  // ================== تفقيط الأرقام وتحويلها إلى كلمات عربية ==================
  tafqeet(num, currency = 'ر.ي') {
    if (!num || isNaN(num) || Number(num) <= 0) return '';
    if (typeof window !== 'undefined' && typeof window.Tafqeet === 'function') {
      const words = window.Tafqeet(num, currency);
      return words ? `فقط ${words} لا غير` : '';
    }
    return `فقط ${App.formatNumber(num)} ${currency} لا غير`;
  },

  // جلب الأرقام التسلسلية التالية لجميع السندات والقيود مباشرة داخل الشاشة
  async fetchNextNumbers() {
    try {
      const res = await fetch('/api/accounting/next-numbers');
      const json = await res.json();
      if (json.success && json.data) {
        this.nextNumbers = json.data;
        const rcBadge = document.getElementById('modalRcReceiptNoBadge');
        if (rcBadge && json.data.receipt_voucher) rcBadge.textContent = json.data.receipt_voucher;

        const expBadge = document.getElementById('modalExpReceiptNoBadge');
        if (expBadge && json.data.expense_voucher) expBadge.textContent = json.data.expense_voucher;

        const jeBadge = document.getElementById('modalJeEntryNoBadge');
        if (jeBadge && json.data.journal_entry) jeBadge.textContent = json.data.journal_entry;

        return json.data;
      }
    } catch (e) {
      console.warn('Could not fetch next voucher numbers:', e);
    }
    return null;
  },

  // معالجة تغيير عملة سند القبض وحساب المعادل بالريال اليمني
  onReceiptCurrencyChange() {
    const currSelect = document.getElementById('modalRcCurrency');
    const convRow = document.getElementById('modalRcCurrencyConversionRow');
    const rateInput = document.getElementById('modalRcExchangeRate');
    if (!currSelect || !convRow || !rateInput) return;

    const val = currSelect.value;
    if (val === 'ر.ي' || val === 'YER') {
      convRow.style.display = 'none';
      rateInput.value = '1.0';
    } else {
      convRow.style.display = 'block';
      let foundRate = 1.0;
      if (Array.isArray(this.currencies)) {
        const found = this.currencies.find(c => c.code === val || c.symbol === val || (val === 'ر.س' && c.code === 'SAR') || (val === '$' && c.code === 'USD'));
        if (found && found.exchange_rate) foundRate = found.exchange_rate;
      }
      if (foundRate === 1.0) {
        if (val === 'ر.س') foundRate = 425;
        if (val === '$') foundRate = 1620;
      }
      rateInput.value = foundRate;
    }
    this.calcReceiptLocalAmount();
  },

  calcReceiptLocalAmount() {
    const amtInput = document.getElementById('modalRcAmount');
    const rateInput = document.getElementById('modalRcExchangeRate');
    const localInput = document.getElementById('modalRcLocalAmount');
    const tafqeetEl = document.getElementById('modalRcLocalTafqeet');
    if (!amtInput || !rateInput || !localInput) return;

    const amt = parseFloat(amtInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 1.0;
    const local = Math.round(amt * rate * 100) / 100;
    localInput.value = local;

    if (tafqeetEl) {
      const curr = document.getElementById('modalRcCurrency')?.value || 'ر.ي';
      if (curr !== 'ر.ي' && local > 0) {
        tafqeetEl.innerHTML = `المعادل بالعملة المحلية: <strong style="color: var(--gold-light);">${App.formatNumber(local)} ر.ي</strong> (${this.tafqeet(local, 'ر.ي')})`;
      } else {
        tafqeetEl.innerHTML = '';
      }
    }
  },

  // فتح نافذة منبثقة لتسجيل سند قبض جديد مع إظهار رقم السند داخل نفس الشاشة
  async openNewReceiptModal(prefill = null) {
    await this.loadDropdowns();
    await this.fetchNextNumbers();
    const dateInput = document.getElementById('modalRcDate');
    const form = document.getElementById('modalReceiptForm');
    if (form) form.reset();
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const checkRow = document.getElementById('modalRcCheckRow');
    if (checkRow) checkRow.style.display = 'none';
    const convRow = document.getElementById('modalRcCurrencyConversionRow');
    if (convRow) convRow.style.display = 'none';
    const tafqeetEl = document.getElementById('modalRcLocalTafqeet');
    if (tafqeetEl) tafqeetEl.innerHTML = '';

    if (prefill) {
      if (prefill.client_id || prefill.client_name) {
        const clientInput = document.getElementById('modalRcClientInput');
        const clientHidden = document.getElementById('modalRcClientSelect');
        const cName = prefill.client_name || (this.clients || []).find(c => c.id == prefill.client_id)?.name || '';
        if (clientInput) clientInput.value = cName;
        if (clientHidden) clientHidden.value = prefill.client_id || '';
        if (cName) await this.onClientInputChange(cName);
      }
      if (prefill.project_id) {
        const prjSelect = document.getElementById('modalRcProjectSelect');
        if (prjSelect) prjSelect.value = prefill.project_id;
      }
      if (prefill.contract_id) {
        const cntSelect = document.getElementById('modalRcContractSelect');
        if (cntSelect) cntSelect.value = prefill.contract_id;
      }
      if (prefill.category) {
        const catSelect = document.getElementById('modalRcCategory');
        if (catSelect) {
          catSelect.value = prefill.category;
          this.onReceiptCategoryChange(prefill.category);
        }
      }
      if (prefill.bill_id) {
        const bSelect = document.getElementById('modalRcBillSelect');
        if (bSelect) {
          bSelect.value = prefill.bill_id;
          this.onReceiptBillChange(prefill.bill_id);
        }
      }
      if (prefill.amount) {
        const amtInput = document.getElementById('modalRcAmount');
        if (amtInput) {
          amtInput.value = prefill.amount;
          this.calcReceiptLocalAmount();
        }
      }
      if (prefill.notes) {
        const notesInput = document.getElementById('modalRcNotes');
        if (notesInput) notesInput.value = prefill.notes;
      }
    }

    // التحقق الصارم من توفر الحسابات والمشاريع ومراكز التكلفة وجلبها فوراً عند الحاجة
    if (!this.accounts || !this.accounts.length) {
      try {
        const aRes = await fetch('/api/accounting/accounts?usable_only=true').then(r => r.json());
        if (aRes.success && Array.isArray(aRes.data)) this.accounts = aRes.data;
      } catch (e) {}
    }
    if (!this.costCenters || !this.costCenters.length) {
      try {
        const ccRes = await fetch('/api/accounting/cost-centers').then(r => r.json());
        if (ccRes.success && Array.isArray(ccRes.data)) this.costCenters = ccRes.data;
      } catch (e) {}
    }
    if (!this.projects || !this.projects.length) {
      try {
        const pRes = await fetch('/api/projects').then(r => r.json());
        if (pRes.success && Array.isArray(pRes.data)) this.projects = pRes.data;
      } catch (e) {}
    }
    if (!this.bankAccounts || !this.bankAccounts.length) {
      try {
        const bRes = await fetch('/api/bank-reconciliation/accounts').then(r => r.json());
        if (bRes.success && Array.isArray(bRes.data)) this.bankAccounts = bRes.data;
      } catch (e) {}
    }
    if (!this.clients || !this.clients.length) {
      try {
        const cRes = await fetch('/api/clients').then(r => r.json());
        if (cRes.success && Array.isArray(cRes.data)) this.clients = cRes.data;
      } catch (e) {}
    }

    if (!this.paymentMethods || !this.paymentMethods.length) {
      try {
        const pmRes = await fetch('/api/payments/methods').then(r => r.json());
        if (pmRes.success && Array.isArray(pmRes.data)) this.paymentMethods = pmRes.data;
      } catch (e) {}
    }
    if (!this.financialAccounts || !this.financialAccounts.length) {
      try {
        const faRes = await fetch('/api/payments/financial-accounts').then(r => r.json());
        if (faRes.success && Array.isArray(faRes.data)) this.financialAccounts = faRes.data;
      } catch (e) {}
    }

    // ملء قوائم الحسابات، المشاريع، ومراكز التكلفة فوراً
    if (this.accounts && this.accounts.length) {
      const formatLeafAcc = a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`;
      this.populateSelectCustom('modalRcAccountSelect', this.accounts, formatLeafAcc);
    }
    if (this.costCenters && this.costCenters.length) {
      this.populateSelectCustom('modalRcCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
    }
    if (this.projects && this.projects.length) {
      const prjSelect = document.getElementById('modalRcProjectSelect');
      if (prjSelect) {
        const currVal = prjSelect.value;
        prjSelect.innerHTML = `<option value="">عام / بدون مشروع محدد...</option>` +
          this.projects.map(p => `<option value="${p.id}" ${currVal == p.id ? 'selected' : ''}>${p.name}</option>`).join('');
      }
    }
    if (this.bankAccounts && this.bankAccounts.length) {
      const formatBank = b => `${b.bank_name} - ${b.account_number} (${b.currency || 'ر.ي'})`;
      this.populateSelectCustom('modalRcBankAccountSelect', this.bankAccounts, formatBank);
    }
    if (this.clients && this.clients.length) {
      const dl = document.getElementById('modalRcClientDatalist');
      if (dl) {
        dl.innerHTML = this.clients.map(c => `<option value="${c.name}">${c.phone ? 'هاتف: ' + c.phone : ''}</option>`).join('');
      }
    }

    const payMethodSelect = document.getElementById('modalRcPaymentMethod');
    if (payMethodSelect) {
      this.handlePaymentMethodChange(payMethodSelect, 'modalRcCheckRow');
    }

    App.openModal('newReceiptModal');
  },

  // كنية متوافقة لاستدعاء نافذة سند القبض
  async openReceiptModal(prefill = null) {
    return this.openNewReceiptModal(prefill);
  },

  // حفظ سند قبض من النافذة المنبثقة
  async submitReceiptVoucherModal(e) {
    if (e) e.preventDefault();
    const client_input = document.getElementById('modalRcClientInput')?.value?.trim();
    let client_id = document.getElementById('modalRcClientSelect')?.value || null;
    let client_name = client_input || null;

    if (client_input && !client_id) {
      const match = (this.clients || []).find(c => c.name === client_input || String(c.id) === client_input);
      if (match) {
        client_id = match.id;
        client_name = match.name;
      }
    }

    const project_id = document.getElementById('modalRcProjectSelect')?.value || null;
    const contract_id = document.getElementById('modalRcContractSelect')?.value || null;
    const bill_id = document.getElementById('modalRcBillSelect')?.value || null;
    const receipt_category = document.getElementById('modalRcCategory')?.value || 'bill_collection';
    const account_id = document.getElementById('modalRcAccountSelect')?.value || null;
    const financial_account_id = document.getElementById('modalRcFinancialAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('modalRcCostCenterSelect')?.value || null;
    const date = document.getElementById('modalRcDate').value;
    const payment_method = document.getElementById('modalRcPaymentMethod').value;
    const check_no = document.getElementById('modalRcCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('modalRcBankName')?.value?.trim() || null;
    const amount = document.getElementById('modalRcAmount').value;
    const currency = document.getElementById('modalRcCurrency')?.value || 'ر.ي';
    const exchange_rate = currency === 'ر.ي' ? 1.0 : (parseFloat(document.getElementById('modalRcExchangeRate')?.value) || 1.0);
    const local_amount = currency === 'ر.ي' ? Number(amount) : (parseFloat(document.getElementById('modalRcLocalAmount')?.value) || (Number(amount) * exchange_rate));
    const bank_account_id = document.getElementById('modalRcBankAccountSelect')?.value || null;
    const notes = document.getElementById('modalRcNotes').value;
    const idempotency_key = 'rc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    if (!client_id && !client_name) {
      App.showToast('يرجى اختيار أو كتابة اسم العميل', 'error');
      return;
    }
    if (!account_id) {
      App.showToast('يرجى اختيار الحساب المحاسبي من دليل الحسابات', 'error');
      document.getElementById('modalRcAccountSelect')?.focus();
      return;
    }
    const selectedAcc = (this.allAccounts || []).find(a => String(a.id) === String(account_id)) || (this.accounts || []).find(a => String(a.id) === String(account_id));
    if (selectedAcc && ((selectedAcc.children_count && selectedAcc.children_count > 0) || (selectedAcc.is_posting === 0 && selectedAcc.level < 5))) {
      App.showToast('لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.', 'error');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد المبلغ بشكل صحيح', 'error');
      return;
    }
    if (payment_method === 'تحويل بنكي' && !bank_account_id) {
      App.showToast('يرجى تحديد حساب البنك لإتمام التحويل البنكي', 'error');
      document.getElementById('modalRcBankAccountSelect')?.focus();
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند اختيار طريقة الدفع بشيك', 'error');
      document.getElementById('modalRcCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotency_key
        },
        body: JSON.stringify({
          type: 'قبض',
          client_id: client_id || null,
          client_name: client_name || client_input,
          project_id: project_id || null,
          contract_id: contract_id ? Number(contract_id) : null,
          bill_id: bill_id ? Number(bill_id) : null,
          receipt_category,
          account_id: account_id ? Number(account_id) : null,
          financial_account_id: financial_account_id ? Number(financial_account_id) : null,
          bank_account_id: bank_account_id ? Number(bank_account_id) : null,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          exchange_rate,
          local_amount,
          notes,
          idempotency_key
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند القبض بنجاح (${data.receipt_no}) وتحديث رصيد العميل آلياً ✅`, 'success');
        App.closeModal('newReceiptModal');
        const form = document.getElementById('modalReceiptForm');
        if (form) form.reset();
        
        // تحديث جميع الجداول والشاشات فوراً
        App.loadRevenuesTable();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) Reports.loadDashboardKPIs();
        this.loadCashMovement();

        // تحديث شاشة العملاء ومودال السلسلة إن كان مفتوحاً
        if (typeof App !== 'undefined') {
          if (App.loadClientsTable) App.loadClientsTable();
          if (App.currentChainClientId == client_id && App.openClientChainModal) {
            App.openClientChainModal(client_id);
          }
        }
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) Reports.loadDashboardKPIs();
        this.loadCashMovement();
        
        // إمكانية الطباعة الفورية
        if (confirm(`تم إنشاء سند القبض ${data.receipt_no}. هل تريد طباعة السند الآن؟`)) {
          const acc = (this.accounts || []).find(a => String(a.id) === String(account_id));
          const cc = (this.costCenters || []).find(c => String(c.id) === String(cost_center_id));
          this.printReceipt({
            receipt_no: data.receipt_no,
            date,
            client_name: this.clients.find(c => c.id == client_id)?.name || 'العميل',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            account_code: acc?.code || acc?.account_code || '',
            account_name: acc?.name || acc?.account_name || '',
            cost_center_code: cc?.code || '',
            cost_center_name: cc?.name || '',
            amount,
            currency,
            payment_method,
            check_no,
            bank_name,
            notes
          });
        }
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء الحفظ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // حفظ سند قبض من النموذج السريع (الإيرادات)
  async submitReceiptVoucher(e) {
    if (e) e.preventDefault();
    const client_id = document.getElementById('rcClientSelect').value;
    const project_id = document.getElementById('rcProjectSelect').value;
    const account_id = document.getElementById('rcAccountSelect')?.value || null;
    const bank_account_id = document.getElementById('rcBankAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('rcCostCenterSelect')?.value || null;
    const date = document.getElementById('rcDate').value;
    const payment_method = document.getElementById('rcPaymentMethod').value;
    const check_no = document.getElementById('rcCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('rcBankName')?.value?.trim() || null;
    const amount = document.getElementById('rcAmount').value;
    const currency = document.getElementById('rcCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('rcNotes').value;

    if (!account_id) {
      App.showToast('يرجى اختيار الحساب المحاسبي من دليل الحسابات', 'error');
      document.getElementById('rcAccountSelect')?.focus();
      return;
    }
    const selectedAcc = (this.allAccounts || []).find(a => String(a.id) === String(account_id)) || (this.accounts || []).find(a => String(a.id) === String(account_id));
    if (selectedAcc && ((selectedAcc.children_count && selectedAcc.children_count > 0) || (selectedAcc.is_posting === 0 && selectedAcc.level < 5))) {
      App.showToast('لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.', 'error');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد المبلغ بشكل صحيح', 'error');
      return;
    }
    if (payment_method === 'تحويل بنكي' && !bank_account_id) {
      App.showToast('يرجى تحديد حساب البنك لإتمام التحويل البنكي', 'error');
      document.getElementById('rcBankAccountSelect')?.focus();
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند اختيار طريقة الدفع بشيك', 'error');
      document.getElementById('rcCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'قبض',
          client_id,
          project_id,
          account_id: account_id ? Number(account_id) : null,
          bank_account_id: bank_account_id ? Number(bank_account_id) : null,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند القبض بنجاح (${data.receipt_no})`, 'success');
        this.resetReceiptForm();
        App.loadRevenuesTable();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) Reports.loadDashboardKPIs();
        this.loadCashMovement();
        // إمكانية الطباعة الفورية
        if (confirm(`تم إنشاء سند القبض ${data.receipt_no}. هل تريد طباعة السند الآن؟`)) {
          const acc = (this.accounts || []).find(a => String(a.id) === String(account_id));
          const cc = (this.costCenters || []).find(c => String(c.id) === String(cost_center_id));
          this.printReceipt({
            receipt_no: data.receipt_no,
            date,
            client_name: this.clients.find(c => c.id == client_id)?.name || 'العميل',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            account_code: acc?.code || acc?.account_code || '',
            account_name: acc?.name || acc?.account_name || '',
            cost_center_code: cc?.code || '',
            cost_center_name: cc?.name || '',
            amount,
            currency,
            payment_method,
            check_no,
            bank_name,
            notes
          });
        }
      } else {
        App.showToast(data.message || 'حدث خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  resetReceiptForm() {
    const form = document.getElementById('quickReceiptForm');
    if (form) form.reset();
    const dateInput = document.getElementById('rcDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const checkRow = document.getElementById('rcCheckFieldsRow');
    if (checkRow) checkRow.style.display = 'none';
  },

  // حفظ سند صرف من النموذج السريع (المصروفات)
  async submitExpenseVoucher(e) {
    if (e) e.preventDefault();
    const expense_type = document.getElementById('expTypeSelect').value;
    const project_id = document.getElementById('expProjectSelect').value;
    const supplier_id = document.getElementById('expSupplierSelect').value;
    const account_id = document.getElementById('expAccountSelect')?.value || null;
    const bank_account_id = document.getElementById('expBankAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('expCostCenterSelect')?.value || null;
    const date = document.getElementById('expDate').value;
    const payment_method = document.getElementById('expPaymentMethod').value;
    const check_no = document.getElementById('expCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('expBankName')?.value?.trim() || null;
    const amount = document.getElementById('expAmount').value;
    const currency = document.getElementById('expCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('expNotes').value;

    if (!account_id) {
      App.showToast('يرجى اختيار الحساب المحاسبي من دليل الحسابات', 'error');
      document.getElementById('expAccountSelect')?.focus();
      return;
    }
    const selectedAcc = (this.allAccounts || []).find(a => String(a.id) === String(account_id)) || (this.accounts || []).find(a => String(a.id) === String(account_id));
    if (selectedAcc && ((selectedAcc.children_count && selectedAcc.children_count > 0) || (selectedAcc.is_posting === 0 && selectedAcc.level < 5))) {
      App.showToast('لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.', 'error');
      return;
    }

    if (!expense_type || !amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد نوع المصروف والمبلغ', 'error');
      return;
    }
    if (payment_method === 'تحويل بنكي' && !bank_account_id) {
      App.showToast('يرجى تحديد حساب البنك لإتمام التحويل البنكي', 'error');
      document.getElementById('expBankAccountSelect')?.focus();
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند الصرف بشيك', 'error');
      document.getElementById('expCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_type,
          project_id,
          supplier_id,
          account_id: account_id ? Number(account_id) : null,
          bank_account_id: bank_account_id ? Number(bank_account_id) : null,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند الصرف بنجاح (${data.receipt_no})`, 'success');
        this.resetExpenseForm();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) Reports.loadDashboardKPIs();
        Projects.loadProjects();
        this.loadCashMovement();
      } else {
        App.showToast(data.message || 'حدث خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  resetExpenseForm() {
    const form = document.getElementById('quickExpenseForm');
    if (form) form.reset();
    const dateInput = document.getElementById('expDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const checkRow = document.getElementById('expCheckFieldsRow');
    if (checkRow) checkRow.style.display = 'none';
  },

  // حفظ النثريات والعهد من النموذج السريع
  async submitCustody(e) {
    if (e) e.preventDefault();
    const operation_type = document.getElementById('custodyTypeSelect').value;
    const empSelect = document.getElementById('custodyEmployeeSelect');
    const employee_id = empSelect ? empSelect.value : null;
    const employee_name = empSelect?.options[empSelect.selectedIndex]?.text?.split('(')[0]?.trim() || document.getElementById('custodyEmpName')?.value?.trim();
    const related_custody_id = document.getElementById('custodyRelatedSelect')?.value || null;
    const total_amount = document.getElementById('custodyTotalAmount').value;
    const currency = document.getElementById('custodyCurrency')?.value || 'ر.ي';
    const spent_amount = document.getElementById('custodySpentAmount')?.value || 0;
    const date = document.getElementById('custodyDate').value;
    const notes = document.getElementById('custodyNotes')?.value || '';

    if (!employee_name || !total_amount || Number(total_amount) <= 0) {
      App.showToast('يرجى اختيار الموظف وتحديد مبلغ العهدة', 'error');
      return;
    }
    if (operation_type === 'تصفية عهدة' && !related_custody_id) {
      App.showToast('يرجى اختيار رقم العهدة الأصلية المراد تصفيتها', 'error');
      document.getElementById('custodyRelatedSelect')?.focus();
      return;
    }

    const account_id = document.getElementById('quickCustodyAccountSelect')?.value || null;

    try {
      const res = await fetch('/api/accounting/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_type,
          employee_id,
          employee_name,
          related_custody_id,
          account_id,
          total_amount,
          spent_amount,
          currency,
          date,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم تسجيل حركة العهدة بنجاح وتحديث الصندوق', 'success');
        this.loadRecentCustodySummary();
        App.loadCustodyTable();
        if (window.App && App.loadCashTable) App.loadCashTable();
        const form = document.getElementById('quickCustodyForm');
        if (form) form.reset();
        const relRow = document.getElementById('quickCustodyRelatedRow');
        if (relRow) relRow.style.display = 'none';
        const dInput = document.getElementById('custodyDate');
        if (dInput) dInput.value = new Date().toISOString().split('T')[0];
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // معالجة تغيير عملة سند الصرف وحساب المعادل بالريال اليمني
  onExpenseCurrencyChange() {
    const currSelect = document.getElementById('modalExpCurrency');
    const convRow = document.getElementById('modalExpCurrencyConversionRow');
    const rateInput = document.getElementById('modalExpExchangeRate');
    if (!currSelect || !convRow || !rateInput) return;

    const val = currSelect.value;
    if (val === 'ر.ي' || val === 'YER') {
      convRow.style.display = 'none';
      rateInput.value = '1.0';
    } else {
      convRow.style.display = 'block';
      let foundRate = 1.0;
      if (Array.isArray(this.currencies)) {
        const found = this.currencies.find(c => c.code === val || c.symbol === val || (val === 'ر.س' && c.code === 'SAR') || (val === '$' && c.code === 'USD'));
        if (found && found.exchange_rate) foundRate = found.exchange_rate;
      }
      if (foundRate === 1.0) {
        if (val === 'ر.س') foundRate = 425;
        if (val === '$') foundRate = 1620;
      }
      rateInput.value = foundRate;
    }
    this.calcExpenseLocalAmount();
  },

  calcExpenseLocalAmount() {
    const amtInput = document.getElementById('modalExpAmount');
    const rateInput = document.getElementById('modalExpExchangeRate');
    const localInput = document.getElementById('modalExpLocalAmount');
    const tafqeetEl = document.getElementById('modalExpLocalTafqeet');
    if (!amtInput || !rateInput || !localInput) return;

    const amt = parseFloat(amtInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 1.0;
    const local = Math.round(amt * rate * 100) / 100;
    localInput.value = local;

    if (tafqeetEl) {
      const curr = document.getElementById('modalExpCurrency')?.value || 'ر.ي';
      if (curr !== 'ر.ي' && local > 0) {
        tafqeetEl.innerHTML = `المعادل بالعملة المحلية: <strong style="color: var(--gold-light);">${App.formatNumber(local)} ر.ي</strong> (${this.tafqeet(local, 'ر.ي')})`;
      } else {
        tafqeetEl.innerHTML = '';
      }
    }
  },

  // فتح نافذة سند صرف جديد مع إظهار رقم السند داخل نفس الشاشة
  async openNewExpenseModal() {
    await this.loadDropdowns();
    await this.fetchNextNumbers();
    const form = document.getElementById('modalExpenseForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalExpDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // التحقق الصارم من توفر الحسابات والمشاريع ومراكز التكلفة وجلبها فوراً عند الحاجة
    if (!this.accounts || !this.accounts.length) {
      try {
        const aRes = await fetch('/api/accounting/accounts?usable_only=true').then(r => r.json());
        if (aRes.success && Array.isArray(aRes.data)) this.accounts = aRes.data;
      } catch (e) {}
    }
    if (!this.costCenters || !this.costCenters.length) {
      try {
        const ccRes = await fetch('/api/accounting/cost-centers').then(r => r.json());
        if (ccRes.success && Array.isArray(ccRes.data)) this.costCenters = ccRes.data;
      } catch (e) {}
    }
    if (!this.projects || !this.projects.length) {
      try {
        const pRes = await fetch('/api/projects').then(r => r.json());
        if (pRes.success && Array.isArray(pRes.data)) this.projects = pRes.data;
      } catch (e) {}
    }
    if (!this.suppliers || !this.suppliers.length) {
      try {
        const sRes = await fetch('/api/suppliers').then(r => r.json());
        if (sRes.success && Array.isArray(sRes.data)) this.suppliers = sRes.data;
      } catch (e) {}
    }
    if (!this.bankAccounts || !this.bankAccounts.length) {
      try {
        const bRes = await fetch('/api/bank-reconciliation/accounts').then(r => r.json());
        if (bRes.success && Array.isArray(bRes.data)) this.bankAccounts = bRes.data;
      } catch (e) {}
    }

    // ملء قوائم المشاريع والموردين والحسابات ومراكز التكلفة
    if (this.projects && this.projects.length) {
      const projSelect = document.getElementById('modalExpProjectSelect');
      if (projSelect) {
        projSelect.innerHTML = `<option value="">اختر المشروع (اختياري)...</option>` +
          this.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      }
    }
    if (this.suppliers && this.suppliers.length) {
      const suppSelect = document.getElementById('modalExpSupplierSelect');
      if (suppSelect) {
        suppSelect.innerHTML = `<option value="">اختر المورد (اختياري)...</option>` +
          this.suppliers.map(s => `<option value="${s.id}">${s.name} (${s.category || 'مورد'})</option>`).join('');
      }
    }
    if (this.accounts && this.accounts.length) {
      this.populateSelectCustom('modalExpAccountSelect', this.accounts, a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`);
    }
    if (this.costCenters && this.costCenters.length) {
      this.populateSelectCustom('modalExpCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
    }
    if (this.bankAccounts && this.bankAccounts.length) {
      const formatBank = b => `${b.bank_name} - ${b.account_number} (${b.currency || 'ر.ي'})`;
      this.populateSelectCustom('modalExpBankAccountSelect', this.bankAccounts, formatBank);
    }

    const checkRow = document.getElementById('modalExpCheckRow');
    if (checkRow) checkRow.style.display = 'none';
    const convRow = document.getElementById('modalExpCurrencyConversionRow');
    if (convRow) convRow.style.display = 'none';
    const tafqeetEl = document.getElementById('modalExpLocalTafqeet');
    if (tafqeetEl) tafqeetEl.innerHTML = '';

    const expPayMethod = document.getElementById('modalExpPaymentMethod');
    if (expPayMethod) {
      this.handlePaymentMethodChange(expPayMethod, 'modalExpCheckRow');
    }

    App.openModal('newExpenseModal');
  },

  // حفظ سند الصرف من النافذة المنبثقة
  async submitExpenseVoucherModal(e) {
    if (e) e.preventDefault();
    const expense_type = document.getElementById('modalExpTypeSelect')?.value || 'مصروف عام';
    const project_id = document.getElementById('modalExpProjectSelect')?.value || null;
    const supplier_input = document.getElementById('modalExpSupplierInput')?.value?.trim();
    let supplier_id = document.getElementById('modalExpSupplierSelect')?.value || null;
    let supplier_name = supplier_input || null;

    if (supplier_input && !supplier_id) {
      const match = (this.suppliers || []).find(s => s.name === supplier_input || String(s.id) === supplier_input);
      if (match) {
        supplier_id = match.id;
        supplier_name = match.name;
      }
    }

    const account_id = document.getElementById('modalExpAccountSelect')?.value || null;
    const bank_account_id = document.getElementById('modalExpBankAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('modalExpCostCenterSelect')?.value || null;
    const date = document.getElementById('modalExpDate').value;
    const payment_method = document.getElementById('modalExpPaymentMethod').value;
    const check_no = document.getElementById('modalExpCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('modalExpBankName')?.value?.trim() || null;
    const amount = document.getElementById('modalExpAmount').value;
    const currency = document.getElementById('modalExpCurrency')?.value || 'ر.ي';
    const exchange_rate = currency === 'ر.ي' ? 1.0 : (parseFloat(document.getElementById('modalExpExchangeRate')?.value) || 1.0);
    const local_amount = currency === 'ر.ي' ? Number(amount) : (parseFloat(document.getElementById('modalExpLocalAmount')?.value) || (Number(amount) * exchange_rate));
    const notes = document.getElementById('modalExpNotes').value;

    if (!account_id) {
      App.showToast('يرجى اختيار الحساب المحاسبي من دليل الحسابات', 'error');
      document.getElementById('modalExpAccountSelect')?.focus();
      return;
    }

    const selectedAcc = (this.allAccounts || []).find(a => String(a.id) === String(account_id)) || (this.accounts || []).find(a => String(a.id) === String(account_id));
    if (selectedAcc && ((selectedAcc.children_count && selectedAcc.children_count > 0) || (selectedAcc.is_posting === 0 && selectedAcc.level < 5))) {
      App.showToast('لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.', 'error');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد المبلغ المطلوب بشكل صحيح', 'error');
      return;
    }
    if (payment_method === 'تحويل بنكي' && !bank_account_id) {
      App.showToast('يرجى تحديد حساب البنك لإتمام التحويل البنكي', 'error');
      document.getElementById('modalExpBankAccountSelect')?.focus();
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند الصرف بشيك', 'error');
      document.getElementById('modalExpCheckNo')?.focus();
      return;
    }

    const financial_account_id = document.getElementById('modalExpFinancialAccountSelect')?.value || null;
    const idempotency_key = 'exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotency_key
        },
        body: JSON.stringify({
          expense_type: expense_type || 'مصروف عام',
          project_id: project_id || null,
          supplier_id: supplier_id || null,
          supplier_name: supplier_name || supplier_input,
          account_id: account_id ? Number(account_id) : null,
          financial_account_id: financial_account_id ? Number(financial_account_id) : null,
          bank_account_id: bank_account_id ? Number(bank_account_id) : null,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          exchange_rate,
          local_amount,
          notes,
          idempotency_key
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند الصرف بنجاح (${data.receipt_no})`, 'success');
        App.closeModal('newExpenseModal');
        const form = document.getElementById('modalExpenseForm');
        if (form) form.reset();

        App.loadExpensesTable();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) Reports.loadDashboardKPIs();
        if (typeof Projects !== 'undefined' && Projects.loadProjects) {
          Projects.loadProjects();
        }
        this.loadCashMovement();

        if (confirm(`تم تسجيل سند الصرف ${data.receipt_no}. هل تريد طباعة السند الآن؟`)) {
          const acc = (this.accounts || []).find(a => String(a.id) === String(account_id));
          const cc = (this.costCenters || []).find(c => String(c.id) === String(cost_center_id));
          this.printExpenseReceipt({
            receipt_no: data.receipt_no,
            date,
            expense_type,
            supplier_name: this.suppliers.find(s => s.id == supplier_id)?.name || '-',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            account_code: acc?.code || acc?.account_code || '',
            account_name: acc?.name || acc?.account_name || '',
            cost_center_code: cc?.code || '',
            cost_center_name: cc?.name || '',
            amount,
            currency,
            payment_method,
            check_no,
            bank_name,
            notes
          });
        }
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء الحفظ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // فتح نافذة تسجيل عهدة جديدة
  openNewCustodyModal() {
    this.loadDropdowns();
    const form = document.getElementById('modalCustodyForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalCustodyDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const remInput = document.getElementById('modalCustodyRemainingAmount');
    if (remInput) remInput.value = '0';
    const relRow = document.getElementById('modalCustodyRelatedRow');
    if (relRow) relRow.style.display = 'none';
    App.openModal('newCustodyModal');
  },

  // فتح نافذة تصفية عهدة محددة مسبقاً
  async openSettleCustodyModal(custodyId, custodyNo, employeeName, employeeId, remainingAmount, currency) {
    this.openNewCustodyModal();
    const typeSelect = document.getElementById('modalCustodyTypeSelect');
    if (typeSelect) {
      typeSelect.value = 'تصفية عهدة';
      this.handleCustodyTypeChange('modalCustodyTypeSelect', 'modalCustodyRelatedRow');
    }
    const empSelect = document.getElementById('modalCustodyEmployeeSelect');
    if (empSelect) {
      for (let i = 0; i < empSelect.options.length; i++) {
        if ((employeeName && empSelect.options[i].text.includes(employeeName)) || (employeeId && empSelect.options[i].value == employeeId)) {
          empSelect.selectedIndex = i;
          break;
        }
      }
      await this.onCustodyEmployeeChange('modalCustodyEmployeeSelect', 'modalCustodyRelatedSelect');
      const relSelect = document.getElementById('modalCustodyRelatedSelect');
      if (relSelect) {
        relSelect.value = custodyId;
        this.onRelatedCustodySelect('modalCustodyRelatedSelect', 'modalCustodyTotalAmount', 'modalCustodySpentAmount');
      }
    }
  },

  calcModalCustodyRemaining() {
    const total = Number(document.getElementById('modalCustodyTotalAmount')?.value) || 0;
    const spent = Number(document.getElementById('modalCustodySpentAmount')?.value) || 0;
    const remEl = document.getElementById('modalCustodyRemainingAmount');
    if (remEl) remEl.value = Math.max(0, total - spent);
  },

  // حفظ العهدة من النافذة المنبثقة
  async submitCustodyModal(e) {
    if (e) e.preventDefault();
    const operation_type = document.getElementById('modalCustodyTypeSelect').value;
    const empSelect = document.getElementById('modalCustodyEmployeeSelect');
    const employee_id = empSelect ? empSelect.value : null;
    const employee_name = empSelect?.options[empSelect.selectedIndex]?.text?.split('(')[0]?.trim() || document.getElementById('modalCustodyEmpName')?.value?.trim();
    const related_custody_id = document.getElementById('modalCustodyRelatedSelect')?.value || null;
    const account_id = document.getElementById('modalCustodyAccountSelect')?.value || null;
    const payment_method = document.getElementById('modalCustodyPaymentMethod')?.value || 'نقدي';
    const date = document.getElementById('modalCustodyDate').value;
    const currency = document.getElementById('modalCustodyCurrency')?.value || 'ر.ي';
    const total_amount = document.getElementById('modalCustodyTotalAmount').value;
    const spent_amount = document.getElementById('modalCustodySpentAmount').value || 0;
    const notes = document.getElementById('modalCustodyNotes').value;

    if (!employee_name || !total_amount || Number(total_amount) <= 0) {
      App.showToast('يرجى اختيار الموظف وإدخال مبلغ العهدة', 'error');
      return;
    }
    if (operation_type === 'تصفية عهدة' && !related_custody_id) {
      App.showToast('يرجى تحديد رقم العهدة الأصلية المراد تصفيتها', 'error');
      document.getElementById('modalCustodyRelatedSelect')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/accounting/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_type,
          employee_id,
          employee_name,
          related_custody_id,
          account_id,
          payment_method,
          total_amount,
          spent_amount,
          currency,
          date,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم تسجيل حركة العهدة بنجاح وتحديث الصندوق والبنك', 'success');
        App.closeModal('newCustodyModal');
        const form = document.getElementById('modalCustodyForm');
        if (form) form.reset();

        App.loadCustodyTable();
        this.loadRecentCustodySummary();
        if (window.App && App.loadCashTable) App.loadCashTable();
      } else {
        App.showToast(data.message || 'حدث خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // طباعة سند صرف رسمي على الورقة الرسمية المعتمدة
  printExpenseReceipt(info) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    let currLabel = 'ريال يمني (ر.ي)';
    if (info.currency === 'ر.س') currLabel = 'ريال سعودي (ر.س)';
    else if (info.currency === '$' || info.currency === 'USD') currLabel = 'دولار أمريكي ($)';

    const words = this.tafqeet(info.amount, info.currency);
    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المستلم',
      sig2: 'أمين الصندوق / المحاسب',
      sig3: 'اعتماد الإدارة',
      show_stamp: '1',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ومعتمدة من الإدارة المالية',
      expense_title: 'سـنـد صـرف رسـمـي',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1'
    };

    const showTafqeet = (cfg.voucher_show_tafqeet !== '0' && cfg.voucher_show_tafqeet !== 0 && cfg.voucher_show_tafqeet !== false);
    const showProject = (cfg.voucher_show_project !== '0' && cfg.voucher_show_project !== 0 && cfg.voucher_show_project !== false);
    const showPaymentMethod = (cfg.voucher_show_payment_method !== '0' && cfg.voucher_show_payment_method !== 0 && cfg.voucher_show_payment_method !== false);
    const titleText = cfg.expense_title || 'سـنـد صـرف رسـمـي';

    const plainClass = (cfg.header_style === 'plain') ? ' plain-mode' : '';
    const fontClass = cfg.font_family ? ` font-${cfg.font_family.toLowerCase()}` : ' font-cairo';
    const scaleClass = cfg.font_size_scale ? ` scale-${cfg.font_size_scale}` : '';
    const isDual = (cfg.voucher_layout === 'dual_a4');

    const renderSingleVoucher = (copyLabel = '') => `
      <div class="letterhead-content-wrap" style="${isDual ? 'min-height: auto; padding: 4px 0;' : ''}">
        <div>
          <!-- ترويسة نوع السند وبياناته -->
          <div class="letterhead-doc-header" style="border-bottom-color: #dc2626;">
            <div class="letterhead-doc-title-badge" style="background: linear-gradient(135deg, #7f1d1d, #991b1b); border-right-color: #ef4444;">
              ${titleText} ${copyLabel ? `<span style="font-size:0.75rem; font-weight:normal;">(${copyLabel})</span>` : ''}
            </div>
            <div class="letterhead-doc-meta">
              <div class="letterhead-doc-meta-item">رقم السند: <strong>${info.receipt_no || ('PV-' + Date.now().toString().slice(-4))}</strong></div>
              <div class="letterhead-doc-meta-item">التاريخ والوقت: <strong>${info.date || new Date().toISOString().split('T')[0]} - ${new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}</strong></div>
              <div class="letterhead-doc-meta-item">المستخدم المسجل: <strong>${(typeof Settings !== 'undefined' && Settings.getCurrentUserName) ? Settings.getCurrentUserName() : 'علوي محمد باعبيد'}</strong></div>
            </div>
          </div>

          <!-- بطاقة المبلغ المالي -->
          <div class="voucher-amount-card" style="border-color: #ef4444; background: #fff5f5; ${isDual ? 'padding: 6px 12px; margin: 6px 0 8px 0;' : ''}">
            <div>
              <span style="font-size: 0.95rem; color: #475569; font-weight: bold; margin-left: 8px;">المبلغ المصروف:</span>
              <span class="voucher-amount-value" style="color: #dc2626;">${App.formatNumber(info.amount)} ${currLabel}</span>
            </div>
            ${showTafqeet ? `<div class="voucher-amount-words" style="color: #991b1b;">فقط: ${words} لا غير.</div>` : ''}
          </div>

          <!-- جدول تفاصيل وبيانات السند -->
          <table class="voucher-grid-table" style="${isDual ? 'margin-bottom: 6px;' : ''}">
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">صرفنا إلى الأخ/السادة:</td>
              <td class="val-cell">${info.supplier_name && info.supplier_name !== '-' ? info.supplier_name : (info.paid_to || 'المستفيد الميداني')}</td>
            </tr>
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">نوع المصروف / البند:</td>
              <td class="val-cell">${info.expense_type || 'مصروفات مشاريع'}</td>
            </tr>
            ${info.account_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">الحساب المالي (الدليل):</td>
              <td class="val-cell"><strong>${info.account_code ? info.account_code + ' - ' : ''}${info.account_name}</strong></td>
            </tr>` : ''}
            ${info.cost_center_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">مركز التكلفة:</td>
              <td class="val-cell">${info.cost_center_code ? info.cost_center_code + ' - ' : ''}${info.cost_center_name}</td>
            </tr>` : ''}
            ${showProject ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">المشروع التابع له:</td>
              <td class="val-cell">${info.project_name || 'عام / تشغيلي'}</td>
            </tr>` : ''}
            ${showPaymentMethod ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">طريقة الدفع:</td>
              <td class="val-cell">${info.payment_method || 'نقدي'}${info.check_no ? ` (شيك رقم: <strong>${info.check_no}</strong>${info.bank_name ? ' - بنك ' + info.bank_name : ''})` : ''}</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">وذلك عن (البيان):</td>
              <td class="val-cell">${info.notes || 'مصروفات وأعمال مشتريات للمشروع'}</td>
            </tr>
          </table>
        </div>

        <!-- التواقيع والاعتماد والختم -->
        <div>
          ${(typeof Settings !== 'undefined' && Settings.renderReportSignatures) ? Settings.renderReportSignatures(cfg) : `
          <div class="letterhead-signatures-row">
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig1 || 'المستلم'}</div>
              <div class="letterhead-sig-dots">التوقيع: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig2 || 'أمين الصندوق / المحاسب'}</div>
              <div class="letterhead-sig-dots">المحاسب: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
          </div>
          `}

          ${cfg.footer_notes ? `<div style="margin-top: ${isDual ? '6px' : '15px'}; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : ''}
        </div>
      </div>
    `;

    if (isDual) {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 10mm 12mm !important; min-height: 270mm; background-image: none !important; background-color: #ffffff !important;">
          <div class="dual-voucher-container">
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة أصلية')}
            </div>
            <div class="dual-voucher-divider">
              <span>✂️ خط القص والتنقيط (سند مزدوج A4)</span>
            </div>
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة الأرشيف / الإدارة')}
            </div>
          </div>
        </div>
      `;
    } else {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 14mm 16mm !important; background-image: none !important; background-color: #ffffff !important;">
          ${renderSingleVoucher()}
        </div>
      `;
    }

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`سند صرف - ${info.receipt_no || ''}`);
    }
    window.print();
  },

  // طباعة سند عهدة أو تصفية عهدة رسمي
  printCustodyReceipt(info) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    let currLabel = 'ريال يمني (ر.ي)';
    if (info.currency === 'ر.س') currLabel = 'ريال سعودي (ر.س)';
    else if (info.currency === '$' || info.currency === 'USD') currLabel = 'دولار أمريكي ($)';

    const words = this.tafqeet(info.total_amount, info.currency);
    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المستلم / صاحب العهدة',
      sig2: 'أمين الصندوق / المحاسب',
      sig3: 'اعتماد الإدارة',
      footer_notes: 'تعتبر هذه العهدة في ذمة الموظف لحين تقديم الفواتير الرسمية والتصفية',
      voucher_layout: 'single_a4'
    };

    const isDual = (cfg.voucher_layout === 'dual_a4');
    const isLiquidation = (info.operation_type === 'تصفية عهدة');
    const accentColor = isLiquidation ? '#059669' : '#2563eb';
    const titleText = isLiquidation ? 'سـنـد تـصـفـيـة عـهـدة مـالـيـة' : 'سـنـد صـرف عـهـدة مـالـيـة';

    const renderSingleVoucher = (copyLabel = '') => `
      <div class="letterhead-content-wrap" style="${isDual ? 'min-height: auto; padding: 4px 0;' : ''}">
        <div>
          <div class="letterhead-doc-header" style="border-bottom-color: ${accentColor};">
            <div class="letterhead-doc-title-badge" style="background: linear-gradient(135deg, ${accentColor}, #1e3a8a); border-right-color: ${accentColor};">
              ${titleText} ${copyLabel ? `<span style="font-size:0.75rem; font-weight:normal;">(${copyLabel})</span>` : ''}
            </div>
            <div class="letterhead-doc-meta">
              <div class="letterhead-doc-meta-item">رقم السند: <strong>${info.custody_no || ('CST-' + (info.id || Date.now().toString().slice(-4)))}</strong></div>
              <div class="letterhead-doc-meta-item">التاريخ: <strong>${info.date || new Date().toISOString().split('T')[0]}</strong></div>
              <div class="letterhead-doc-meta-item">نوع العملية: <strong>${info.operation_type || 'صرف عهدة'}</strong></div>
            </div>
          </div>

          <div class="voucher-amount-card" style="border-color: ${accentColor}; background: #f8fafc; ${isDual ? 'padding: 6px 12px; margin: 6px 0 8px 0;' : ''}">
            <div>
              <span style="font-size: 0.95rem; color: #475569; font-weight: bold; margin-left: 8px;">مبلغ العهدة / التصفية:</span>
              <span class="voucher-amount-value" style="color: ${accentColor};">${App.formatNumber(info.total_amount)} ${currLabel}</span>
            </div>
            ${words ? `<div class="voucher-amount-words">فقط: ${words} لا غير.</div>` : ''}
          </div>

          <table class="voucher-grid-table" style="${isDual ? 'margin-bottom: 6px;' : ''}">
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الموظف المسؤول:</td>
              <td class="val-cell"><strong>${info.employee_name || '-'}</strong> ${info.employee_no ? `<span class="badge badge-info" style="margin-right: 8px;">رقم الموظف: ${info.employee_no}</span>` : ''}</td>
            </tr>
            ${isLiquidation ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">العهدة الأصلية المصفاة:</td>
              <td class="val-cell"><strong style="color: #2563eb;">${info.related_custody_no || (info.related_custody_id ? 'CST-' + info.related_custody_id : 'سند عهدة سابق')}</strong></td>
            </tr>
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">المصروف الفعلي:</td>
              <td class="val-cell" style="color: #dc2626; font-weight: bold;">${App.formatNumber(info.spent_amount || 0)} ${currLabel}</td>
            </tr>
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الرصيد المتبقي:</td>
              <td class="val-cell" style="color: #059669; font-weight: bold;">${App.formatNumber(info.remaining_amount || 0)} ${currLabel}</td>
            </tr>
            ` : ''}
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الغرض والبيان:</td>
              <td class="val-cell">${info.notes || 'عهدة نثريات ومصروفات ميدانية'}</td>
            </tr>
          </table>
        </div>

        <div>
          <div class="letterhead-signatures-row">
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig1 || 'المستلم / صاحب العهدة'}</div>
              <div class="letterhead-sig-dots">التوقيع: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig2 || 'أمين الصندوق / المحاسب'}</div>
              <div class="letterhead-sig-dots">المحاسب: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
          </div>
          ${cfg.footer_notes ? `<div style="margin-top: 15px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : ''}
        </div>
      </div>
    `;

    printArea.innerHTML = `
      <div class="official-letterhead-page font-cairo" style="padding: 14mm 16mm !important; background-image: none !important; background-color: #ffffff !important;">
        ${renderSingleVoucher()}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`سند عهدة - ${info.custody_no || ''}`);
    }
    window.print();
  },

  // طباعة تجريبية لورقة السند من الإعدادات
  printTestReceipt() {
    this.printReceipt({
      receipt_no: 'RC-2026-0008',
      date: new Date().toISOString().split('T')[0],
      client_name: 'علوي محمد باعبيد',
      amount: 1000,
      currency: '$',
      project_name: 'مدرسة التواهي النموذجية',
      payment_method: 'نقدي',
      notes: 'دفعة أعمال مقاولات وهندسة (نموذج تجريبي للطباعة)'
    });
  },

  // تحديث أرقام بطاقة العهدة في لوحة التحكم
  async loadRecentCustodySummary() {
    try {
      const res = await fetch('/api/accounting/custodies');
      const data = await res.json();
      if (data.success && data.data.length > 0) {
        const latest = data.data[0];
        const totalEl = document.getElementById('custodySummaryTotal');
        const spentEl = document.getElementById('custodySummarySpent');
        const remainEl = document.getElementById('custodySummaryRemain');
        const curr = latest.currency || 'ر.ي';
        if (totalEl) totalEl.textContent = `${App.formatNumber(latest.total_amount)} ${curr}`;
        if (spentEl) spentEl.textContent = `${App.formatNumber(latest.spent_amount)} ${curr}`;
        if (remainEl) remainEl.textContent = `${App.formatNumber(latest.remaining_amount)} ${curr}`;
      }
    } catch (e) {}
  },

  // جلب وتحديث أرقام حركة الصندوق والبنك
  async loadCashMovement() {
    try {
      const res = await fetch('/api/accounting/cash-movements');
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        const prevBalEl = document.getElementById('cashPrevBalance');
        const inEl = document.getElementById('cashIncome');
        const outEl = document.getElementById('cashExpense');
        const withEl = document.getElementById('cashWithdrawal');
        const curBalEl = document.getElementById('cashCurBalance');

        if (prevBalEl) prevBalEl.textContent = App.formatNumber(s.initial_balance || 50000);
        if (inEl) inEl.textContent = App.formatNumber(s.total_cash_in || 25000);
        if (outEl) outEl.textContent = App.formatNumber(s.total_cash_out || 15000);
        if (withEl) withEl.textContent = App.formatNumber(s.total_withdrawals || 5000);
        if (curBalEl) curBalEl.textContent = App.formatNumber(s.current_balance || 55000);
      }
    } catch (e) {
      console.error('Error loading cash movements:', e);
    }
  },

  // تجهيز وطباعة سند رسمي على الورقة الرسمية المعتمدة
  printReceipt(info) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المستلم / المحاسب',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      show_stamp: '0',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ومعتمدة من الإدارة المالية',
      receipt_title: 'سـنـد قـبـض رسـمـي',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1'
    };

    let currLabel = 'ريال يمني (ر.ي)';
    if (info.currency === 'ر.س') currLabel = 'ريال سعودي (ر.س)';
    else if (info.currency === '$' || info.currency === 'USD') currLabel = 'دولار أمريكي ($)';

    const words = this.tafqeet(info.amount, info.currency);
    const showTafqeet = (cfg.voucher_show_tafqeet !== '0' && cfg.voucher_show_tafqeet !== 0 && cfg.voucher_show_tafqeet !== false);
    const showProject = (cfg.voucher_show_project !== '0' && cfg.voucher_show_project !== 0 && cfg.voucher_show_project !== false);
    const showPaymentMethod = (cfg.voucher_show_payment_method !== '0' && cfg.voucher_show_payment_method !== 0 && cfg.voucher_show_payment_method !== false);
    const titleText = cfg.receipt_title || 'سـنـد قـبـض رسـمـي';

    const plainClass = (cfg.header_style === 'plain') ? ' plain-mode' : '';
    const fontClass = cfg.font_family ? ` font-${cfg.font_family.toLowerCase()}` : ' font-cairo';
    const scaleClass = cfg.font_size_scale ? ` scale-${cfg.font_size_scale}` : '';
    const accentColor = cfg.accent_color || '#d4af37';
    const isDual = (cfg.voucher_layout === 'dual_a4');

    const renderSingleVoucher = (copyLabel = '') => `
      <div class="letterhead-content-wrap" style="${isDual ? 'min-height: auto; padding: 4px 0;' : ''}">
        <div>
          <!-- ترويسة نوع السند وبياناته -->
          <div class="letterhead-doc-header" style="border-bottom-color: ${accentColor};">
            <div class="letterhead-doc-title-badge" style="border-right-color: ${accentColor};">
              ${titleText} ${copyLabel ? `<span style="font-size:0.75rem; font-weight:normal;">(${copyLabel})</span>` : ''}
            </div>
            <div class="letterhead-doc-meta">
              <div class="letterhead-doc-meta-item">رقم السند: <strong>${info.receipt_no || ('RC-' + Date.now().toString().slice(-4))}</strong></div>
              <div class="letterhead-doc-meta-item">التاريخ والوقت: <strong>${info.date || new Date().toISOString().split('T')[0]} - ${new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}</strong></div>
              <div class="letterhead-doc-meta-item">المستخدم المسجل: <strong>${(typeof Settings !== 'undefined' && Settings.getCurrentUserName) ? Settings.getCurrentUserName() : 'علوي محمد باعبيد'}</strong></div>
            </div>
          </div>

          <!-- بطاقة المبلغ المالي -->
          <div class="voucher-amount-card" style="border-color: ${accentColor}; ${isDual ? 'padding: 6px 12px; margin: 6px 0 8px 0;' : ''}">
            <div>
              <span style="font-size: 0.95rem; color: #475569; font-weight: bold; margin-left: 8px;">المبلغ المقبوض:</span>
              <span class="voucher-amount-value">${App.formatNumber(info.amount)} ${currLabel}</span>
            </div>
            ${showTafqeet ? `<div class="voucher-amount-words">فقط: ${words} لا غير.</div>` : ''}
          </div>

          <!-- جدول تفاصيل وبيانات السند -->
          <table class="voucher-grid-table" style="${isDual ? 'margin-bottom: 6px;' : ''}">
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">استلمنا من الأخ/السادة:</td>
              <td class="val-cell">${info.client_name || '-'}</td>
            </tr>
            ${info.account_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الحساب المالي (الدليل):</td>
              <td class="val-cell"><strong>${info.account_code ? info.account_code + ' - ' : ''}${info.account_name}</strong></td>
            </tr>` : ''}
            ${info.cost_center_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">مركز التكلفة:</td>
              <td class="val-cell">${info.cost_center_code ? info.cost_center_code + ' - ' : ''}${info.cost_center_name}</td>
            </tr>` : ''}
            ${showProject ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">المشروع التابع له:</td>
              <td class="val-cell">${info.project_name || 'عام / تشغيلي'}</td>
            </tr>` : ''}
            ${showPaymentMethod ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">طريقة الدفع:</td>
              <td class="val-cell">${info.payment_method || 'نقدي'}${info.check_no ? ` (شيك رقم: <strong>${info.check_no}</strong>${info.bank_name ? ' - بنك ' + info.bank_name : ''})` : ''}</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">وذلك عن (البيان):</td>
              <td class="val-cell">${info.notes || 'دفعة أعمال مقاولات وهندسة'}</td>
            </tr>
          </table>
        </div>

        <!-- التواقيع والاعتماد والختم -->
        <div>
          ${(typeof Settings !== 'undefined' && Settings.renderReportSignatures) ? Settings.renderReportSignatures(cfg) : `
          <div class="letterhead-signatures-row">
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig1 || 'المستلم / المحاسب'}</div>
              <div class="letterhead-sig-dots">المحاسب: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig2 || 'المدير العام'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
          </div>
          `}

          ${cfg.footer_notes ? `<div style="margin-top: ${isDual ? '6px' : '15px'}; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.78rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : ''}
        </div>
      </div>
    `;

    if (isDual) {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 10mm 12mm !important; min-height: 270mm; background-image: none !important; background-color: #ffffff !important;">
          <div class="dual-voucher-container">
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة العميل')}
            </div>
            <div class="dual-voucher-divider">
              <span>✂️ خط القص والتنقيط (سند مزدوج A4)</span>
            </div>
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة الأرشيف / الإدارة')}
            </div>
          </div>
        </div>
      `;
    } else {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 14mm 16mm !important; background-image: none !important; background-color: #ffffff !important;">
          ${renderSingleVoucher()}
        </div>
      `;
    }

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`سند قبض - ${info.receipt_no || ''}`);
    }
    window.print();
  },

  // ================== إدارة العملاء ==================
  openNewClientModal(targetSelectId = null) {
    this._targetClientSelectId = targetSelectId;
    const form = document.getElementById('newClientForm');
    if (form) form.reset();
    App.openModal('newClientModal');
  },

  async submitNewClient(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById('clientName');
    const name = nameInput ? nameInput.value.trim() : '';
    const company = document.getElementById('clientCompany') ? document.getElementById('clientCompany').value.trim() : '';
    const phone = document.getElementById('clientPhone') ? document.getElementById('clientPhone').value.trim() : '';
    const email = document.getElementById('clientEmail') ? document.getElementById('clientEmail').value.trim() : '';
    const address = document.getElementById('clientAddress') ? document.getElementById('clientAddress').value.trim() : '';
    const previous_balance = document.getElementById('clientPrevBal') ? document.getElementById('clientPrevBal').value : 0;
    const currency = document.getElementById('clientCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('clientNotes') ? document.getElementById('clientNotes').value.trim() : '';

    if (!name) {
      App.showToast('يرجى إدخال اسم العميل / المستثمر', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    const form = document.getElementById('newClientForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'حفظ العميل';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, company, phone, email, address, previous_balance, currency, notes
        })
      });
      const data = await res.json();

      if (res.ok && data.success && data.id) {
        // إظهار رسالة النجاح والتأكيد من قاعدة البيانات
        const successMsg = data.message || `تم حفظ العميل (${name}) بنجاح وتأكيده في قاعدة البيانات`;
        App.showToast(successMsg, 'success');
        App.closeModal('newClientModal');
        if (form) form.reset();

        // تحديث القوائم المنسدلة وسجل العملاء والمشاريع
        await this.loadDropdowns();
        if (typeof Projects !== 'undefined' && Projects.loadProjects) {
          Projects.loadProjects();
        }
        if (typeof App !== 'undefined' && App.loadClientsTable) {
          App.loadClientsTable();
        }

        // تحديد العميل المضاف تلقائياً في القائمة الهدف إن وجدت
        if (this._targetClientSelectId) {
          const targetEl = document.getElementById(this._targetClientSelectId);
          if (targetEl && data.id) {
            targetEl.value = String(data.id);
          }
          this._targetClientSelectId = null;
        }
      } else {
        App.showToast(data.message || 'فشل في حفظ العميل في قاعدة البيانات', 'error');
      }
    } catch (e) {
      console.error('Error adding client:', e);
      App.showToast('فشل الاتصال بالخادم أو حفظ العميل في قاعدة البيانات', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  // ================== إدارة الموردين (SRM / Vendor Management) ==================
  toggleCustomCategoryInput(show) {
    const wrapper = document.getElementById('customCategoryWrapper');
    const customInput = document.getElementById('suppCustomCategory');
    const catSelect = document.getElementById('suppCategory');
    if (!wrapper) return;

    if (show) {
      wrapper.style.display = 'block';
      if (customInput) customInput.focus();
      if (catSelect) {
        for (let opt of catSelect.options) {
          if (opt.value.includes('أخرى') || opt.value === 'أخرى') {
            catSelect.value = opt.value;
            break;
          }
        }
      }
    } else {
      wrapper.style.display = 'none';
      if (customInput) customInput.value = '';
      if (catSelect && (catSelect.value.includes('أخرى') || catSelect.value === 'أخرى')) {
        catSelect.value = 'مواد بناء وأسمنت وحديد';
      }
    }
  },

  onCategorySelectChange(selectEl) {
    if (!selectEl) return;
    const val = selectEl.value;
    if (val.includes('أخرى') || val === 'أخرى') {
      this.toggleCustomCategoryInput(true);
    } else {
      const wrapper = document.getElementById('customCategoryWrapper');
      if (wrapper && wrapper.style.display !== 'none') {
        const customInput = document.getElementById('suppCustomCategory');
        if (!customInput || !customInput.value.trim()) {
          this.toggleCustomCategoryInput(false);
        }
      }
    }
  },

  // ================== إدارة ملفات ومرفقات الموردين والماسح الضوئي ==================
  _supplierAttachments: [],
  _scannerStream: null,
  _scannerCapturedData: null,
  _scannerFacingMode: 'environment',

  onCurrencyChange(selectEl) {
    const curr = selectEl?.value || 'YER';
    const symMap = {
      'YER': 'ر.ي',
      'SAR': 'ر.س',
      'USD': '$'
    };
    const sym = symMap[curr] || curr;
    const badge = document.getElementById('suppCurrencySymbolBadge');
    if (badge) badge.textContent = sym;
    const hint = document.getElementById('suppCurrencyBadgeHint');
    if (hint) hint.textContent = `(${sym})`;

    // تحديث مؤشرات التجميع المالي بنفس العملة إن لم تكن هناك قيم مفوترة مخصصة
    const invEl = document.getElementById('dispSuppInvoicedAmount');
    if (invEl && invEl.textContent.includes('إجمالي المفوتر')) {
      const match = invEl.textContent.match(/[\d,.]+/);
      const amount = match ? match[0] : '0.00';
      invEl.textContent = `إجمالي المفوتر: ${amount} ${sym}`;
    }
    const paidEl = document.getElementById('dispSuppTotalPaid');
    if (paidEl) {
      const match = paidEl.textContent.match(/[\d,.]+/);
      const amount = match ? match[0] : '0.00';
      paidEl.textContent = `${amount} ${sym}`;
    }
    const outEl = document.getElementById('dispSuppOutstanding');
    if (outEl) {
      const match = outEl.textContent.match(/[\d,.]+/);
      const amount = match ? match[0] : '0.00';
      outEl.textContent = `${amount} ${sym}`;
    }
  },

  async handleSupplierInvoiceUpload(event) {
    const files = event.target?.files;
    if (!files || files.length === 0) return;
    if (!this._supplierAttachments) this._supplierAttachments = [];

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

    for (let file of Array.from(files)) {
      if (!allowed.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
        App.showToast(`الملف (${file.name}) غير مدعوم. الصيغ المدعومة: PDF أو صور JPG/PNG/WEBP`, 'error');
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        App.showToast(`حجم الملف (${file.name}) يتجاوز الحد الأقصى المسموح (20MB)`, 'error');
        continue;
      }

      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        this._supplierAttachments.push({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          name: file.name,
          type: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
          size: file.size,
          data: dataUrl,
          date: new Date().toLocaleString('ar-YE')
        });

        App.showToast(`تم إرفاق المستند (${file.name}) بنجاح 📄`, 'success');
      } catch (err) {
        console.error('Error reading invoice file:', err);
        App.showToast(`تعذر قراءة الملف: ${file.name}`, 'error');
      }
    }

    if (event.target) event.target.value = '';
    this.renderSupplierAttachments();
  },

  onInvoiceDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById('suppInvoiceDropzone');
    if (dropzone) {
      dropzone.style.borderColor = '#38bdf8';
      dropzone.style.background = 'rgba(56, 189, 248, 0.12)';
    }
  },

  onInvoiceDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById('suppInvoiceDropzone');
    if (dropzone) {
      dropzone.style.borderColor = 'rgba(148, 163, 184, 0.25)';
      dropzone.style.background = 'rgba(15, 23, 42, 0.4)';
    }
  },

  onInvoiceDrop(e) {
    this.onInvoiceDragLeave(e);
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      this.handleSupplierInvoiceUpload({ target: { files: dt.files } });
    }
  },

  renderSupplierAttachments() {
    const listEl = document.getElementById('suppInvoicesList');
    const emptyEl = document.getElementById('suppInvoiceEmptyState');
    if (!listEl) return;

    const list = this._supplierAttachments || [];
    if (list.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      listEl.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    listEl.style.display = 'flex';

    listEl.innerHTML = list.map((item, idx) => {
      const isPdf = item.type === 'application/pdf' || (item.name && item.name.toLowerCase().endsWith('.pdf'));
      const sizeStr = item.size ? (item.size > 1024 * 1024 ? `${(item.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(item.size / 1024)} KB`) : '';
      
      const iconOrThumb = isPdf
        ? `<div style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 6px 10px; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; gap: 4px;">
             <i class="fa fa-file-pdf"></i> PDF
           </div>`
        : `<img src="${item.data}" style="width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid #334155;">`;

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--card-bg, #0f172a); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 8px 12px; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
            ${iconOrThumb}
            <div style="overflow: hidden; text-align: right;">
              <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 320px;" title="${item.name}">
                ${item.name}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                <span class="badge" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; font-size: 0.68rem;">${isPdf ? 'مستند PDF' : 'صورة ممسوحة'}</span>
                ${sizeStr ? `&nbsp;•&nbsp; <span>${sizeStr}</span>` : ''}
                ${item.date ? `&nbsp;•&nbsp; <span>${item.date}</span>` : ''}
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="Accounting.viewSupplierAttachment(${idx})" style="padding: 4px 8px; font-size: 0.78rem;" title="معاينة المستند">
              <i class="fa fa-eye"></i> معاينة
            </button>
            <button type="button" class="btn btn-danger btn-sm" onclick="Accounting.removeSupplierInvoiceAttachment(${idx})" style="padding: 4px 8px; font-size: 0.78rem; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #ef4444;" title="حذف الفاتورة">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
    this.updateSupplierLiveBalancePreview();
  },

  removeSupplierInvoiceAttachment(index) {
    if (!this._supplierAttachments || !this._supplierAttachments[index]) return;
    const item = this._supplierAttachments[index];
    this._supplierAttachments.splice(index, 1);
    this.renderSupplierAttachments();
    this.updateSupplierLiveBalancePreview();
    App.showToast(`تم حذف المرفق (${item.name || ''})`, 'info');
  },

  viewSupplierAttachment(index) {
    const list = this._supplierAttachments || window._activeVendorAttachments || (window.App && App._supplierAttachments) || [];
    if (!list || !list[index]) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('لم يتم العثور على مستند المرفق المطلوب للمعاينة', 'warning');
      }
      return;
    }
    const item = list[index];
    const isPdf = item.type === 'application/pdf' || (item.name && item.name.toLowerCase().endsWith('.pdf'));

    const titleEl = document.getElementById('attachmentViewerTitle');
    const bodyEl = document.getElementById('attachmentViewerBody');
    const dlBtn = document.getElementById('attachmentViewerDownloadBtn');

    if (titleEl) titleEl.textContent = `معاينة: ${item.name || 'مستند الفاتورة'}`;
    if (dlBtn) {
      dlBtn.href = item.data;
      dlBtn.download = item.name || 'invoice_document';
    }

    if (bodyEl) {
      if (isPdf) {
        bodyEl.innerHTML = `
          <div style="margin-bottom: 12px; display: flex; justify-content: flex-end; gap: 8px;">
            <a href="${item.data}" target="_blank" class="btn btn-primary btn-sm" style="font-size: 0.78rem;">
              <i class="fa fa-external-link"></i> فتح في نافذة مستقلة ↗️
            </a>
          </div>
          <iframe src="${item.data}" style="width: 100%; height: 70vh; border: 1px solid var(--border-color); border-radius: 8px; background: #fff;"></iframe>
        `;
      } else {
        bodyEl.innerHTML = `
          <div style="margin-bottom: 10px; display: flex; justify-content: flex-end; gap: 8px;">
            <a href="${item.data}" target="_blank" class="btn btn-primary btn-sm" style="font-size: 0.78rem;">
              <i class="fa fa-external-link"></i> فتح الصورة بالحجم الكامل ↗️
            </a>
          </div>
          <div style="display: flex; justify-content: center; align-items: center; min-height: 400px; max-height: 72vh; overflow: auto; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 12px;">
            <img src="${item.data}" alt="${item.name || 'مستند'}" style="max-width: 100%; max-height: 70vh; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.6); object-fit: contain; cursor: zoom-in;" onclick="window.open('${item.data}', '_blank')">
          </div>
        `;
      }
    }

    const modal = document.getElementById('supplierAttachmentViewerModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.style.zIndex = '100100';
      modal.classList.add('active');
    }
  },

  closeAttachmentViewerModal() {
    const modal = document.getElementById('supplierAttachmentViewerModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
    const bodyEl = document.getElementById('attachmentViewerBody');
    if (bodyEl) bodyEl.innerHTML = '';
  },

  updateSupplierLiveBalancePreview() {
    const balInput = document.getElementById('suppBalance');
    const currSelect = document.getElementById('suppCurrency');
    const curr = currSelect ? currSelect.value : 'YER';
    const bal = Number(balInput ? balInput.value : 0) || 0;
    const attCount = this._supplierAttachments ? this._supplierAttachments.length : 0;

    const cntEl = document.getElementById('dispSuppInvoicesCount');
    const invEl = document.getElementById('dispSuppInvoicedAmount');
    const outEl = document.getElementById('dispSuppOutstanding');

    if (cntEl) {
      cntEl.textContent = attCount > 0 ? `${attCount} ${attCount === 1 ? 'فاتورة' : 'فواتير'}` : '0 فاتورة';
    }
    if (invEl) {
      invEl.textContent = `إجمالي المفوتر: ${App.formatNumber(bal)} ${curr}`;
    }
    if (outEl) {
      outEl.textContent = `${App.formatNumber(bal)} ${curr}`;
    }
  },

  // ================== مسح ضوئي مباشر بالكاميرا (Live Document Scanner) ==================
  async openLiveScannerModal() {
    const modal = document.getElementById('supplierLiveScannerModal');
    if (modal) modal.style.display = 'flex';

    this._scannerCapturedData = null;
    const video = document.getElementById('scannerLiveVideo');
    const snapshot = document.getElementById('scannerLiveSnapshot');
    const overlay = document.getElementById('scannerOverlayFrame');
    const btnCapture = document.getElementById('btnCaptureScan');
    const btnRetake = document.getElementById('btnRetakeScan');
    const btnConfirm = document.getElementById('btnConfirmScan');
    const btnSwitch = document.getElementById('btnSwitchCamera');

    if (video) video.style.display = 'block';
    if (snapshot) snapshot.style.display = 'none';
    if (overlay) overlay.style.display = 'flex';
    if (btnCapture) btnCapture.style.display = 'inline-flex';
    if (btnRetake) btnRetake.style.display = 'none';
    if (btnConfirm) btnConfirm.style.display = 'none';

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المتصفح لا يدعم الوصول المباشر لكاميرا الماسح الضوئي');
      }

      this._scannerStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this._scannerFacingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      if (video) {
        video.srcObject = this._scannerStream;
        await video.play().catch(() => {});
      }

      // إظهار زر التبديل إذا كانت هناك كاميرات متعددة
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (btnSwitch) {
        btnSwitch.style.display = videoDevices.length > 1 ? 'inline-flex' : 'none';
      }
    } catch (err) {
      console.warn('Live scanner camera access note:', err);
      App.showToast('تعذر فتح الكاميرا المباشرة، جاري تشغيل لاقط الكاميرا الافتراضي...', 'info');
      this.closeLiveScannerModal();
      const fallbackInput = document.getElementById('suppInvoiceCameraInput');
      if (fallbackInput) fallbackInput.click();
    }
  },

  async switchScannerCamera() {
    this._scannerFacingMode = this._scannerFacingMode === 'environment' ? 'user' : 'environment';
    if (this._scannerStream) {
      this._scannerStream.getTracks().forEach(t => t.stop());
    }
    await this.openLiveScannerModal();
  },

  captureLiveScan() {
    const video = document.getElementById('scannerLiveVideo');
    const canvas = document.getElementById('scannerLiveCanvas');
    const snapshot = document.getElementById('scannerLiveSnapshot');
    const overlay = document.getElementById('scannerOverlayFrame');
    const btnCapture = document.getElementById('btnCaptureScan');
    const btnRetake = document.getElementById('btnRetakeScan');
    const btnConfirm = document.getElementById('btnConfirmScan');

    if (!video || !canvas || !snapshot) return;

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    this._scannerCapturedData = dataUrl;

    snapshot.src = dataUrl;
    snapshot.style.display = 'block';
    video.style.display = 'none';
    if (overlay) overlay.style.display = 'none';

    if (btnCapture) btnCapture.style.display = 'none';
    if (btnRetake) btnRetake.style.display = 'inline-flex';
    if (btnConfirm) btnConfirm.style.display = 'inline-flex';
  },

  retakeLiveScan() {
    const video = document.getElementById('scannerLiveVideo');
    const snapshot = document.getElementById('scannerLiveSnapshot');
    const overlay = document.getElementById('scannerOverlayFrame');
    const btnCapture = document.getElementById('btnCaptureScan');
    const btnRetake = document.getElementById('btnRetakeScan');
    const btnConfirm = document.getElementById('btnConfirmScan');

    this._scannerCapturedData = null;
    if (snapshot) snapshot.style.display = 'none';
    if (video) video.style.display = 'block';
    if (overlay) overlay.style.display = 'flex';

    if (btnCapture) btnCapture.style.display = 'inline-flex';
    if (btnRetake) btnRetake.style.display = 'none';
    if (btnConfirm) btnConfirm.style.display = 'none';
  },

  confirmLiveScan() {
    if (!this._scannerCapturedData) return;
    if (!this._supplierAttachments) this._supplierAttachments = [];

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const fileName = `فاتورة_ممسوحة_${dateStr}_${now.getHours()}${now.getMinutes()}${now.getSeconds()}.jpg`;

    this._supplierAttachments.push({
      id: 'scan_' + Date.now(),
      name: fileName,
      type: 'image/jpeg',
      size: Math.round(this._scannerCapturedData.length * 0.75),
      data: this._scannerCapturedData,
      date: now.toLocaleString('ar-YE')
    });

    this.closeLiveScannerModal();
    this.renderSupplierAttachments();
    App.showToast('تم مسح الفاتورة ضوئياً وإرفاقها بنجاح 📸', 'success');
  },

  closeLiveScannerModal() {
    if (this._scannerStream) {
      try {
        this._scannerStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      this._scannerStream = null;
    }
    const modal = document.getElementById('supplierLiveScannerModal');
    if (modal) modal.style.display = 'none';
  },

  openNewSupplierModal(targetSelectId = null) {
    this._targetSupplierSelectId = targetSelectId;
    const form = document.getElementById('newSupplierForm');
    if (form) form.reset();
    
    const editIdInput = document.getElementById('suppEditId');
    if (editIdInput) editIdInput.value = '';

    const titleEl = document.getElementById('supplierModalTitle');
    if (titleEl) titleEl.textContent = 'ملف تعريف المورد (SRM Profile) / إضافة مورد جديد';

    const saveBtn = document.getElementById('btnSaveSupplier');
    if (saveBtn) saveBtn.innerHTML = '<i class="fa fa-save"></i> حفظ بيانات المورد';

    this.toggleCustomCategoryInput(false);

    // تصفير الرصيد والمرفقات
    const balInput = document.getElementById('suppBalance');
    if (balInput) balInput.value = '0.00';

    this._supplierAttachments = [];
    this.renderSupplierAttachments();

    // تحديث رمز العملة
    const currSelect = document.getElementById('suppCurrency');
    if (currSelect) {
      currSelect.value = 'YER';
      this.onCurrencyChange(currSelect);
    }

    // إعادة ضبط المؤشرات التلقائية إلى صفر مع توضيح أنها تُحسب تلقائياً
    const cntEl = document.getElementById('dispSuppInvoicesCount');
    const invEl = document.getElementById('dispSuppInvoicedAmount');
    const paidEl = document.getElementById('dispSuppTotalPaid');
    const outEl = document.getElementById('dispSuppOutstanding');
    if (cntEl) cntEl.textContent = '0 فاتورة';
    if (invEl) invEl.textContent = 'إجمالي المفوتر: 0.00 ر.ي';
    if (paidEl) paidEl.textContent = '0.00 ر.ي';
    if (outEl) outEl.textContent = '0.00 ر.ي';

    App.openModal('newSupplierModal');
  },

  async openEditSupplierModal(supplierId) {
    if (!supplierId) return;
    const form = document.getElementById('newSupplierForm');
    if (form) form.reset();

    const editIdInput = document.getElementById('suppEditId');
    if (editIdInput) editIdInput.value = String(supplierId);

    const titleEl = document.getElementById('supplierModalTitle');
    if (titleEl) titleEl.textContent = 'تعديل ملف المورد (SRM Profile) - جاري التحميل...';

    const saveBtn = document.getElementById('btnSaveSupplier');
    if (saveBtn) saveBtn.innerHTML = '<i class="fa fa-save"></i> حفظ التعديلات';

    this.toggleCustomCategoryInput(false);

    App.openModal('newSupplierModal');

    try {
      const res = await fetch(`/api/suppliers/${supplierId}/profile?include_recent=false`);
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.message || 'المورد غير موجود');
      }

      const v = json.data;
      const fin = v.financial_summary || {};
      const bank = v.bank_details || {};

      if (titleEl) titleEl.textContent = `تعديل ملف المورد: ${v.company_name}`;
      
      const nameInput = document.getElementById('suppName');
      if (nameInput) nameInput.value = v.company_name || v.name || '';

      const contactInput = document.getElementById('suppContactPerson');
      if (contactInput) contactInput.value = v.contact_person || '';

      // معالجة فئة النشاط: هل هي من الخيارات القياسية أم مخصصة أدخلها المستخدم؟
      const catInput = document.getElementById('suppCategory');
      const customWrapper = document.getElementById('customCategoryWrapper');
      const customInput = document.getElementById('suppCustomCategory');
      const targetCat = v.industry_category || 'مواد بناء وأسمنت وحديد';

      let matchedOption = false;
      if (catInput) {
        for (let opt of catInput.options) {
          if (opt.value === targetCat) {
            catInput.value = targetCat;
            matchedOption = true;
            break;
          }
        }
      }

      if (!matchedOption) {
        // فئة نشاط مخصصة أدخلها المستخدم سابقاً
        if (catInput) {
          const newOpt = document.createElement('option');
          newOpt.value = targetCat;
          newOpt.textContent = `${targetCat} (مخصص) 🏷️`;
          newOpt.selected = true;
          catInput.insertBefore(newOpt, catInput.options[catInput.options.length - 1]);
        }
        if (customWrapper) customWrapper.style.display = 'block';
        if (customInput) customInput.value = targetCat;
      } else {
        if (customWrapper) customWrapper.style.display = 'none';
        if (customInput) customInput.value = '';
      }

      const phoneInput = document.getElementById('suppPhone');
      if (phoneInput) phoneInput.value = v.phone_number || '';

      const addrInput = document.getElementById('suppAddress');
      if (addrInput) addrInput.value = v.address || '';

      const bankNameInput = document.getElementById('suppBankName');
      if (bankNameInput) bankNameInput.value = bank.bank_name && bank.bank_name !== 'غير محدد' ? bank.bank_name : (v.bank_name || '');

      const bankAccInput = document.getElementById('suppBankAccountNo');
      if (bankAccInput) bankAccInput.value = v.bank_account_no || '';

      const bankIbanInput = document.getElementById('suppBankIban');
      if (bankIbanInput) bankIbanInput.value = v.bank_iban || '';

      const currInput = document.getElementById('suppCurrency');
      if (currInput) {
        currInput.value = v.default_currency || 'YER';
        this.onCurrencyChange(currInput);
      }

      // رقم المبلغ (الرصيد / المستحق)
      const balInput = document.getElementById('suppBalance');
      if (balInput) balInput.value = v.balance !== undefined ? v.balance : '0.00';

      const docTypeInput = document.getElementById('suppPaymentDocType');
      if (docTypeInput) docTypeInput.value = v.payment_document_type || 'إيصال عادي';

      const leadTimeInput = document.getElementById('suppLeadTimeDays');
      if (leadTimeInput) leadTimeInput.value = v.supply_lead_time_days !== undefined ? v.supply_lead_time_days : 3;

      const notesInput = document.getElementById('suppNotes');
      if (notesInput) notesInput.value = v.notes || '';

      // تحميل وإظهار فواتير ومستندات المورد المرفقة
      this._supplierAttachments = [];
      if (v.invoice_attachment) {
        try {
          const parsed = typeof v.invoice_attachment === 'string' ? JSON.parse(v.invoice_attachment) : v.invoice_attachment;
          if (Array.isArray(parsed)) {
            this._supplierAttachments = parsed;
          } else if (typeof parsed === 'object') {
            this._supplierAttachments = [parsed];
          }
        } catch (e) {
          if (typeof v.invoice_attachment === 'string' && v.invoice_attachment.startsWith('data:')) {
            const isPdf = v.invoice_attachment.includes('application/pdf');
            this._supplierAttachments = [{
              id: 'att_' + Date.now(),
              name: isPdf ? 'فاتورة_المورد.pdf' : 'فاتورة_ممسوحة.jpg',
              type: isPdf ? 'application/pdf' : 'image/jpeg',
              size: Math.round(v.invoice_attachment.length * 0.75),
              data: v.invoice_attachment,
              date: ''
            }];
          }
        }
      }
      this.renderSupplierAttachments();

      // ملء المؤشرات المالية المحسوبة تلقائياً في الوقت الفعلي
      const curr = v.default_currency || 'YER';
      const cntEl = document.getElementById('dispSuppInvoicesCount');
      const invEl = document.getElementById('dispSuppInvoicedAmount');
      const paidEl = document.getElementById('dispSuppTotalPaid');
      const outEl = document.getElementById('dispSuppOutstanding');
      if (cntEl) cntEl.textContent = `${fin.total_purchase_invoices_count || 0} فاتورة`;
      if (invEl) invEl.textContent = `إجمالي المفوتر: ${App.formatNumber(fin.total_invoiced_amount || 0)} ${curr}`;
      if (paidEl) paidEl.textContent = `${App.formatNumber(fin.total_amount_paid || 0)} ${curr}`;
      if (outEl) outEl.textContent = `${App.formatNumber(fin.outstanding_balance || 0)} ${curr}`;

    } catch (err) {
      console.error('Error fetching supplier for edit:', err);
      App.showToast('تعذر تحميل بيانات المورد: ' + err.message, 'error');
    }
  },

  async submitNewSupplier(e) {
    if (e) e.preventDefault();
    const editId = document.getElementById('suppEditId')?.value;
    const nameInput = document.getElementById('suppName');
    const company_name = nameInput ? nameInput.value.trim() : '';
    const contact_person = document.getElementById('suppContactPerson')?.value.trim() || '';
    
    // فئة النشاط: إما من القائمة المنسدلة أو المدخلة يدوياً
    const selectCat = document.getElementById('suppCategory')?.value || 'مواد بناء وأسمنت وحديد';
    const customCat = document.getElementById('suppCustomCategory')?.value.trim() || '';
    let industry_category = selectCat;

    if (selectCat.includes('أخرى') || selectCat === 'أخرى' || customCat) {
      if (customCat) {
        industry_category = customCat;
      } else if (selectCat.includes('أخرى') || selectCat === 'أخرى') {
        App.showToast('يرجى كتابة فئة النشاط المخصصة في حقل الإدخال', 'error');
        this.toggleCustomCategoryInput(true);
        const ci = document.getElementById('suppCustomCategory');
        if (ci) ci.focus();
        return;
      }
    }

    const phone_number = document.getElementById('suppPhone')?.value.trim() || '';
    const address = document.getElementById('suppAddress')?.value.trim() || '';
    const bank_name = document.getElementById('suppBankName')?.value.trim() || '';
    const bank_account_no = document.getElementById('suppBankAccountNo')?.value.trim() || '';
    const bank_iban = document.getElementById('suppBankIban')?.value.trim() || '';
    const default_currency = document.getElementById('suppCurrency')?.value || 'YER';
    const balance = Number(document.getElementById('suppBalance')?.value) || 0;
    const payment_document_type = document.getElementById('suppPaymentDocType')?.value || 'إيصال عادي';
    const supply_lead_time_days = Number(document.getElementById('suppLeadTimeDays')?.value) || 0;
    const notes = document.getElementById('suppNotes')?.value.trim() || '';
    const invoice_attachment = this._supplierAttachments && this._supplierAttachments.length > 0 
      ? JSON.stringify(this._supplierAttachments) 
      : null;

    if (!company_name) {
      App.showToast('يرجى إدخال اسم الشركة / المورد', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    if (!contact_person) {
      App.showToast('يرجى إدخال اسم الشخص المسؤول (اسم التاجر)', 'error');
      const cp = document.getElementById('suppContactPerson');
      if (cp) cp.focus();
      return;
    }

    if (!phone_number) {
      App.showToast('يرجى إدخال رقم الهاتف المعتمد', 'error');
      const ph = document.getElementById('suppPhone');
      if (ph) ph.focus();
      return;
    }

    const form = document.getElementById('newSupplierForm');
    const submitBtn = document.getElementById('btnSaveSupplier') || (form ? form.querySelector('button[type="submit"]') : null);
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'حفظ بيانات المورد';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتشفير المصرفي...';
    }

    try {
      const isEdit = Boolean(editId);
      const url = isEdit ? `/api/suppliers/${editId}` : '/api/suppliers';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        name: company_name,
        company_name,
        contact_person,
        industry_category,
        category: industry_category,
        phone: phone_number,
        phone_number,
        address,
        bank_name,
        bank_account_no,
        bank_iban,
        currency: default_currency,
        default_currency,
        balance,
        payment_document_type,
        supply_lead_time_days,
        invoice_attachment,
        notes
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const successMsg = data.message || (isEdit ? `تم تحديث ملف المورد (${company_name}) بنجاح` : `تم حفظ المورد (${company_name}) بنجاح وتفعيل ملف الـ SRM`);
        App.showToast(successMsg, 'success');
        App.closeModal('newSupplierModal');
        if (form) form.reset();

        // تحديث القوائم المنسدلة وجدول الموردين
        await this.loadDropdowns();
        if (typeof App !== 'undefined' && App.loadSuppliersTable) {
          App.loadSuppliersTable();
        }

        // تحديد المورد المضاف تلقائياً في القائمة الهدف إن وجدت
        if (this._targetSupplierSelectId && (data.id || data.data?.id)) {
          const targetEl = document.getElementById(this._targetSupplierSelectId);
          if (targetEl) {
            targetEl.value = String(data.id || data.data.id);
          }
          this._targetSupplierSelectId = null;
        }
      } else {
        App.showToast(data.message || 'فشل في حفظ بيانات المورد', 'error');
      }
    } catch (e) {
      console.error('Error saving supplier:', e);
      App.showToast('فشل الاتصال بالخادم أثناء حفظ بيانات المورد', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  // ================== إدارة قيود اليومية العامة (Journal Entries) ==================

  injectPeriodAndAuditButtons() {
    const actions = document.getElementById('journalHeaderActions');
    if (!actions) return;
    if (!document.getElementById('btnJournalPeriods')) {
      const pBtn = document.createElement('button');
      pBtn.id = 'btnJournalPeriods';
      pBtn.className = 'btn btn-warning';
      pBtn.title = 'إدارة وإغلاق الفترات المحاسبية';
      pBtn.innerHTML = '<span>🔒 الفترات المحاسبية</span>';
      pBtn.onclick = () => Accounting.openPeriodsModal();
      actions.insertBefore(pBtn, actions.firstChild);
    }
    if (!document.getElementById('btnJournalAuditLog')) {
      const aBtn = document.createElement('button');
      aBtn.id = 'btnJournalAuditLog';
      aBtn.className = 'btn btn-info';
      aBtn.title = 'سجل التدقيق والرقابة المالية';
      aBtn.innerHTML = '<span>📜 سجل التدقيق</span>';
      aBtn.onclick = () => Accounting.openAuditLogModal();
      const pBtn = document.getElementById('btnJournalPeriods');
      if (pBtn && pBtn.nextSibling) {
        actions.insertBefore(aBtn, pBtn.nextSibling);
      } else {
        actions.appendChild(aBtn);
      }
    }
  },

  async loadJournalEntries() {
    this.injectPeriodAndAuditButtons();
    try {
      const res = await fetch('/api/accounting/journal-entries');
      const data = await res.json();
      if (data.success) {
        this.journalEntries = data.data || [];
        this.renderJournalTable(this.journalEntries);
        this.updateJournalKPIs(this.journalEntries);
      }
    } catch (e) {
      console.error('Error loading journal entries:', e);
      App.showToast('فشل تحميل قيود اليومية', 'error');
    }
  },

  updateJournalKPIs(entries) {
    const countEl = document.getElementById('journalKpiCount');
    const debitEl = document.getElementById('journalKpiDebit');
    const creditEl = document.getElementById('journalKpiCredit');
    const balEl = document.getElementById('journalKpiBalance');

    const totalDebit = entries.reduce((s, e) => s + (Number(e.total_debit) || 0), 0);
    const totalCredit = entries.reduce((s, e) => s + (Number(e.total_credit) || 0), 0);

    if (countEl) countEl.textContent = entries.length;
    if (debitEl) debitEl.textContent = App.formatNumber(totalDebit);
    if (creditEl) creditEl.textContent = App.formatNumber(totalCredit);
    if (balEl) {
      const diff = Math.abs(totalDebit - totalCredit);
      if (diff < 0.01) {
        balEl.textContent = 'متزن 100%';
        balEl.style.color = 'var(--accent-green)';
      } else {
        balEl.textContent = `فارق: ${App.formatNumber(diff)}`;
        balEl.style.color = 'var(--accent-red)';
      }
    }
  },

  renderJournalTable(entries) {
    const tbody = document.getElementById('fullJournalTableBody');
    if (!tbody) return;

    if (!entries || entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد قيود يومية مسجلة حتى الآن</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(je => `
      <tr>
        <td><strong>${je.entry_no}</strong></td>
        <td>${je.date}</td>
        <td>${je.description || '-'}</td>
        <td><span class="badge ${je.reference_type === 'يدوي' ? 'badge-info' : 'badge-active'}">${je.reference_type || 'يدوي'} ${je.reference_no ? '(' + je.reference_no + ')' : ''}</span></td>
        <td style="color: var(--accent-green); font-weight: bold;">${App.formatNumber(je.total_debit)} ${je.currency || 'ر.ي'}</td>
        <td style="color: #38bdf8; font-weight: bold;">${App.formatNumber(je.total_credit)} ${je.currency || 'ر.ي'}</td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 6px; justify-content: center;">
            <button class="btn btn-sm btn-secondary" onclick="Accounting.viewJournalDetails(${je.id})" title="عرض تفاصيل وسطور القيد">👁️ تفاصيل</button>
            <button class="btn btn-sm btn-primary" onclick="Accounting.printJournalEntryById(${je.id})" title="طباعة سند القيد الرسمي">🖨️ طباعة</button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  filterJournalTable() {
    const query = document.getElementById('journalSearchInput')?.value?.toLowerCase()?.trim() || '';
    const refFilter = document.getElementById('journalRefFilter')?.value || '';

    const filtered = this.journalEntries.filter(je => {
      const matchQuery = !query || 
        (je.entry_no && je.entry_no.toLowerCase().includes(query)) ||
        (je.description && je.description.toLowerCase().includes(query)) ||
        (je.reference_no && je.reference_no.toLowerCase().includes(query));

      const matchRef = !refFilter || je.reference_type === refFilter;
      return matchQuery && matchRef;
    });

    this.renderJournalTable(filtered);
  },

  async openNewJournalModal() {
    await this.loadDropdowns();
    if (!this.accounts || this.accounts.length === 0) {
      try {
        const aRes = await fetch('/api/accounting/accounts?usable_only=true').then(r => r.json());
        if (aRes.success && Array.isArray(aRes.data) && aRes.data.length > 0) {
          this.accounts = aRes.data;
        }
      } catch (e) {
        console.warn('Fallback fetching usable accounts:', e);
      }
    }
    if (!this.costCenters || this.costCenters.length === 0) {
      try {
        const ccRes = await fetch('/api/accounting/cost-centers').then(r => r.json());
        if (ccRes.success && Array.isArray(ccRes.data)) {
          this.costCenters = ccRes.data;
        }
      } catch (e) {}
    }
    this.populateSelectCustom('modalJeCostCenter', this.costCenters, cc => `${cc.code} - ${cc.name}`);
    const jeCcSelect = document.getElementById('modalJeCostCenter');
    if (jeCcSelect) {
      jeCcSelect.value = '';
      jeCcSelect.style.borderColor = 'rgba(56, 189, 248, 0.5)';
    }

    await this.fetchNextNumbers();
    const form = document.getElementById('modalJournalForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalJeDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const rateInput = document.getElementById('modalJeExchangeRate');
    if (rateInput) rateInput.value = '1.0';

    // تفريغ جدول الأسطر وإضافة سطرين افتراضيين (طرف مدين وطرف دائن)
    const tbody = document.getElementById('journalLinesTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      this.addJournalRow(); // السطر الأول
      this.addJournalRow(); // السطر الثاني
    }
    this.calcJournalBalance();
    App.openModal('newJournalModal');
  },

  onJournalCurrencyChange() {
    const curr = document.getElementById('modalJeCurrency')?.value || 'ر.ي';
    const rateInput = document.getElementById('modalJeExchangeRate');
    if (!rateInput) return;
    if (curr === 'ر.ي' || curr === 'YER') {
      rateInput.value = '1.0';
    } else {
      let foundRate = 1.0;
      if (Array.isArray(this.currencies)) {
        const found = this.currencies.find(c => c.code === curr || c.symbol === curr || (curr === 'ر.س' && c.code === 'SAR') || (curr === '$' && c.code === 'USD'));
        if (found && found.exchange_rate) foundRate = found.exchange_rate;
      }
      if (foundRate === 1.0) {
        if (curr === 'ر.س') foundRate = 425;
        if (curr === '$') foundRate = 1620;
      }
      rateInput.value = foundRate;
    }
    this.calcJournalBalance();
  },

  addJournalRow(data = {}) {
    const tbody = document.getElementById('journalLinesTableBody');
    if (!tbody) return;

    const rowId = 'je_row_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.className = 'journal-line-row';

    let accountsList = (this.accounts && this.accounts.length > 0) ? this.accounts : (this.allAccounts || []);
    if (accountsList.length > 0 && accountsList.some(a => a.children_count > 0 || (a.level && a.level < 5))) {
      const leaves = accountsList.filter(a => (a.is_posting === 1 || a.level === 5 || a.is_leaf) && (!a.children_count || Number(a.children_count) === 0));
      if (leaves.length > 0) accountsList = leaves;
    }

    const accountOptions = (accountsList || []).map(a => 
      `<option value="${a.id}" data-code="${a.code || a.account_code || ''}" data-type="${a.type || a.account_type || ''}" ${data.account_id == a.id ? 'selected' : ''}>${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || ''})</option>`
    ).join('');

    tr.innerHTML = `
      <td>
        <select class="form-control je-line-account" required style="font-size: 0.85rem;" onchange="Accounting.onJournalAccountChange('${rowId}')">
          <option value="">اختر الحساب...</option>
          ${accountOptions}
        </select>
      </td>
      <td>
        <input type="number" class="form-control je-line-debit" value="${data.debit || 0}" min="0" step="any" placeholder="0.00" oninput="Accounting.onJournalDebitInput('${rowId}')" style="font-weight: bold; color: var(--accent-green); text-align: left; direction: ltr;">
      </td>
      <td>
        <input type="number" class="form-control je-line-credit" value="${data.credit || 0}" min="0" step="any" placeholder="0.00" oninput="Accounting.onJournalCreditInput('${rowId}')" style="font-weight: bold; color: #38bdf8; text-align: left; direction: ltr;">
      </td>
      <td>
        <input type="text" class="form-control je-line-desc" value="${data.description || ''}" placeholder="بيان السطر...">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn btn-sm btn-danger" onclick="Accounting.removeJournalRow('${rowId}')" title="حذف السطر" style="padding: 2px 8px;">✕</button>
      </td>
    `;

    tbody.appendChild(tr);
    this.onJournalAccountChange(rowId);
    this.calcJournalBalance();
  },

  onJournalAccountChange(rowId) {
    const tr = document.getElementById(rowId);
    if (!tr) return;
    const accSelect = tr.querySelector('.je-line-account');
    if (!accSelect) return;

    const opt = accSelect.options[accSelect.selectedIndex];
    const code = opt ? (opt.getAttribute('data-code') || '') : '';
    const type = opt ? (opt.getAttribute('data-type') || '') : '';

    const isNominal = type === 'مصروفات' || type === 'إيرادات' || code.startsWith('4') || code.startsWith('5');
    const jeCcSelect = document.getElementById('modalJeCostCenter');
    if (isNominal && jeCcSelect && !jeCcSelect.value) {
      jeCcSelect.style.borderColor = '#f59e0b';
      jeCcSelect.title = 'مركز التكلفة إلزامي عند استخدام حسابات المصروفات والإيرادات لضمان سلامة تقارير الربحية';
    }
  },

  onJournalDebitInput(rowId) {
    const tr = document.getElementById(rowId);
    if (!tr) return;
    const debitInput = tr.querySelector('.je-line-debit');
    const creditInput = tr.querySelector('.je-line-credit');
    if (debitInput && creditInput && Number(debitInput.value) > 0) {
      creditInput.value = 0;
    }
    this.calcJournalBalance();
  },

  onJournalCreditInput(rowId) {
    const tr = document.getElementById(rowId);
    if (!tr) return;
    const debitInput = tr.querySelector('.je-line-debit');
    const creditInput = tr.querySelector('.je-line-credit');
    if (debitInput && creditInput && Number(creditInput.value) > 0) {
      debitInput.value = 0;
    }
    this.calcJournalBalance();
  },

  removeJournalRow(rowId) {
    const tbody = document.getElementById('journalLinesTableBody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= 2) {
      App.showToast('يجب أن يحتوي القيد المحاسبي على طرفين على الأقل (مدين ودائن)', 'error');
      return;
    }
    const tr = document.getElementById(rowId);
    if (tr) tr.remove();
    this.calcJournalBalance();
  },

  calcJournalBalance() {
    const rows = document.querySelectorAll('#journalLinesTableBody tr');
    let totalDebit = 0;
    let totalCredit = 0;

    rows.forEach(r => {
      const debitInput = r.querySelector('.je-line-debit');
      const creditInput = r.querySelector('.je-line-credit');
      const debitVal = Number(debitInput?.value) || 0;
      const creditVal = Number(creditInput?.value) || 0;
      totalDebit += debitVal;
      totalCredit += creditVal;
    });

    const diff = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    const isBalanced = totalDebit > 0 && diff === 0;

    const totDebEl = document.getElementById('modalJeTotalDebit');
    const totCredEl = document.getElementById('modalJeTotalCredit');
    const diffEl = document.getElementById('modalJeDiff');
    const statusEl = document.getElementById('modalJeBalanceStatus');
    const submitBtn = document.getElementById('btnSubmitJournal');

    if (totDebEl) totDebEl.textContent = App.formatNumber(totalDebit);
    if (totCredEl) totCredEl.textContent = App.formatNumber(totalCredit);
    if (diffEl) diffEl.textContent = App.formatNumber(diff);

    if (statusEl) {
      if (isBalanced) {
        statusEl.innerHTML = '✅ القيد متزن 100% وجاهز للحفظ';
        statusEl.style.background = 'rgba(34, 197, 94, 0.15)';
        statusEl.style.color = '#4ade80';
      } else {
        statusEl.innerHTML = `⚠️ القيد غير متزن (الفارق: ${App.formatNumber(diff)})`;
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#f87171';
      }
    }

    if (submitBtn) {
      submitBtn.disabled = !isBalanced;
    }
  },

  autoBalanceJournal() {
    const rows = document.querySelectorAll('#journalLinesTableBody tr');
    if (rows.length < 2) return;

    let totalDebit = 0;
    let totalCredit = 0;

    // حساب المجاميع باستثناء السطر الأخير
    for (let i = 0; i < rows.length - 1; i++) {
      const d = Number(rows[i].querySelector('.je-line-debit')?.value) || 0;
      const c = Number(rows[i].querySelector('.je-line-credit')?.value) || 0;
      totalDebit += d;
      totalCredit += c;
    }

    const lastRow = rows[rows.length - 1];
    const lastDebit = lastRow.querySelector('.je-line-debit');
    const lastCredit = lastRow.querySelector('.je-line-credit');

    if (totalDebit > totalCredit) {
      // الطرف الدائن يحتاج للفرق
      lastDebit.value = 0;
      lastCredit.value = Math.round((totalDebit - totalCredit) * 100) / 100;
    } else if (totalCredit > totalDebit) {
      // الطرف المدين يحتاج للفرق
      lastCredit.value = 0;
      lastDebit.value = Math.round((totalCredit - totalDebit) * 100) / 100;
    }

    this.calcJournalBalance();
    App.showToast('تمت الموازنة التلقائية للسطر الأخير بنجاح', 'success');
  },

  async submitJournalEntryModal(e) {
    if (e) e.preventDefault();
    const date = document.getElementById('modalJeDate').value;
    const currency = document.getElementById('modalJeCurrency')?.value || 'ر.ي';
    const unifiedCostCenterId = document.getElementById('modalJeCostCenter')?.value || null;
    const description = document.getElementById('modalJeDescription').value.trim();

    if (!description) {
      App.showToast('يرجى كتابة البيان العام للقيد', 'error');
      return;
    }

    // 1. فحص فوري لحالة الفترة المحاسبية
    try {
      const pCheck = await (await fetch(`/api/accounting/check-period?date=${date}`)).json();
      if (pCheck && pCheck.isOpen === false) {
        App.showToast(pCheck.message || 'الفترة المحاسبية لهذا التاريخ مغلقة رسمياً', 'error');
        return;
      }
    } catch (err) {
      console.warn('Period check warning:', err);
    }

    const rows = document.querySelectorAll('#journalLinesTableBody tr');
    if (rows.length < 2) {
      App.showToast('يجب تسجيل سطرين على الأقل (طرف مدين وطرف دائن)', 'error');
      return;
    }

    const lines = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let hasInvalidAccount = false;
    let hasNominalAccount = false;
    let nonLeafAccountMsg = null;

    rows.forEach(r => {
      const accountSelect = r.querySelector('.je-line-account');
      const account_id = accountSelect?.value;
      const debit = Number(r.querySelector('.je-line-debit')?.value) || 0;
      const credit = Number(r.querySelector('.je-line-credit')?.value) || 0;
      const lineDesc = r.querySelector('.je-line-desc')?.value?.trim() || '';

      if (!account_id) {
        hasInvalidAccount = true;
      } else {
        const accObj = (this.allAccounts || []).find(a => String(a.id) === String(account_id)) || (this.accounts || []).find(a => String(a.id) === String(account_id));
        if (accObj && ((accObj.children_count && accObj.children_count > 0) || (accObj.is_posting === 0 && accObj.level < 5))) {
          nonLeafAccountMsg = 'لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.';
        }
      }

      // فحص إلزامية مركز التكلفة لحسابات الأرباح والخسائر
      if (accountSelect && accountSelect.selectedIndex >= 0) {
        const opt = accountSelect.options[accountSelect.selectedIndex];
        const code = opt ? (opt.getAttribute('data-code') || '') : '';
        const type = opt ? (opt.getAttribute('data-type') || '') : '';
        const isNominal = type === 'مصروفات' || type === 'إيرادات' || code.startsWith('4') || code.startsWith('5');
        if (isNominal) {
          hasNominalAccount = true;
        }
      }

      if (debit > 0 || credit > 0) {
        lines.push({
          account_id,
          cost_center_id: unifiedCostCenterId ? Number(unifiedCostCenterId) : null,
          debit,
          credit,
          notes: lineDesc
        });
        totalDebit += debit;
        totalCredit += credit;
      }
    });

    if (hasInvalidAccount) {
      App.showToast('يرجى اختيار الحساب المالي لجميع أسطر القيد', 'error');
      return;
    }

    if (nonLeafAccountMsg) {
      App.showToast(nonLeafAccountMsg, 'error');
      return;
    }

    if (hasNominalAccount && !unifiedCostCenterId) {
      App.showToast('يرجى اختيار مركز التكلفة الموحد للقيد لكونه يتضمن حسابات مصروفات أو إيرادات', 'error');
      const ccEl = document.getElementById('modalJeCostCenter');
      if (ccEl) {
        ccEl.focus();
        ccEl.style.borderColor = '#f59e0b';
      }
      return;
    }

    if (lines.length < 2) {
      App.showToast('يجب أن يتضمن القيد سطرين فعليين بمبالغ مالية على الأقل', 'error');
      return;
    }

    const diff = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    if (diff !== 0 || totalDebit <= 0) {
      App.showToast(`القيد غير متزن محاسبياً! إجمالي المدين: ${totalDebit}، إجمالي الدائن: ${totalCredit}. الفارق: ${diff}`, 'error');
      return;
    }

    const submitBtn = document.getElementById('btnSubmitJournal');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري حفظ القيد في دفتر اليومية...';
    }

    try {
      const res = await fetch('/api/accounting/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          currency,
          exchange_rate: currency === 'ر.ي' ? 1.0 : (parseFloat(document.getElementById('modalJeExchangeRate')?.value) || 1.0),
          description,
          lines
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ القيد اليومي بنجاح (${data.entry_no})`, 'success');
        App.closeModal('newJournalModal');
        await this.loadJournalEntries();
        if (confirm(`تم إنشاء قيد اليومية المتزن ${data.entry_no}. هل تريد استعراض وسند الطباعة الآن؟`)) {
          this.viewJournalDetails(data.id);
        }
      } else {
        App.showToast(data.message || 'فشل حفظ القيد اليومي', 'error');
      }
    } catch (e) {
      console.error('Error saving journal entry:', e);
      App.showToast('فشل الاتصال بالخادم', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'حفظ القيد اليومي المتزن';
      }
    }
  },

  async viewJournalDetails(id) {
    try {
      const res = await fetch(`/api/accounting/journal-entries/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        const je = data.data;
        this.currentJournalEntry = je;

        const titleEl = document.getElementById('viewJeTitle');
        if (titleEl) titleEl.textContent = `تفاصيل قيد اليومية: ${je.entry_no}`;

        const contentEl = document.getElementById('viewJeContent');
        if (contentEl) {
          contentEl.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.5); padding: 14px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 14px;">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">رقم القيد:</span> <strong style="color: var(--gold-light);">${je.entry_no}</strong></div>
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">التاريخ:</span> <strong>${je.date}</strong></div>
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">العملة:</span> <strong>${je.currency || 'ر.ي'}</strong></div>
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">المرجع:</span> <strong>${je.reference_type || 'يدوي'} ${je.reference_no ? '(' + je.reference_no + ')' : ''}</strong></div>
              </div>
              <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                <span style="color: var(--text-secondary); font-size: 0.8rem;">البيان العام:</span> <strong>${je.description || '-'}</strong>
              </div>
            </div>

            <div class="table-responsive">
              <table class="custom-table" style="margin-bottom: 0;">
                <thead>
                  <tr>
                    <th>رقم الحساب</th>
                    <th>اسم الحساب المالي</th>
                    <th>مركز التكلفة</th>
                    <th style="color: var(--accent-green);">مدين (منه)</th>
                    <th style="color: #38bdf8;">دائن (له)</th>
                    <th>البيان والملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  ${(je.lines || []).map(l => `
                    <tr>
                      <td style="font-family: monospace;">${l.account_code || '-'}</td>
                      <td><strong>${l.account_name || '-'}</strong></td>
                      <td>${l.cost_center_name ? `<span class="badge badge-info">${l.cost_center_code ? l.cost_center_code + ' - ' : ''}${l.cost_center_name}</span>` : '-'}</td>
                      <td style="color: var(--accent-green); font-weight: bold; text-align: left; direction: ltr;">${Number(l.debit) > 0 ? App.formatNumber(l.debit) : '-'}</td>
                      <td style="color: #38bdf8; font-weight: bold; text-align: left; direction: ltr;">${Number(l.credit) > 0 ? App.formatNumber(l.credit) : '-'}</td>
                      <td>${l.description || '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="background: #1e293b; font-weight: bold;">
                    <td colspan="3" style="text-align: left;">المجموع الكلي:</td>
                    <td style="color: var(--accent-green); font-size: 1.05rem; text-align: left; direction: ltr;">${App.formatNumber(je.total_debit)}</td>
                    <td style="color: #38bdf8; font-size: 1.05rem; text-align: left; direction: ltr;">${App.formatNumber(je.total_credit)}</td>
                    <td style="color: var(--accent-green); text-align: center;">متزن 100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          `;
        }
        App.openModal('viewJournalModal');
      }
    } catch (e) {
      console.error('Error fetching journal details:', e);
      App.showToast('فشل جلب تفاصيل القيد', 'error');
    }
  },

  async printJournalEntryById(id) {
    try {
      const res = await fetch(`/api/accounting/journal-entries/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        this.currentJournalEntry = data.data;
        this.printCurrentJournalEntry();
      }
    } catch (e) {
      App.showToast('فشل تجهيز طباعة القيد', 'error');
    }
  },

  printCurrentJournalEntry() {
    const je = this.currentJournalEntry;
    if (!je) {
      App.showToast('لا يوجد قيد محدد للطباعة', 'error');
      return;
    }

    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const words = this.tafqeet(je.total_debit, je.currency);

    printArea.innerHTML = `
      <div class="official-letterhead-page font-cairo" style="padding: 14mm 16mm !important; background: #ffffff !important;">
        <div class="letterhead-content-wrap">
          <div>
            <div class="letterhead-doc-header" style="border-bottom-color: #2563eb;">
              <div class="letterhead-doc-title-badge" style="background: linear-gradient(135deg, #1e3a8a, #2563eb); border-right-color: #3b82f6;">
                سـنـد قـيـد يـومـيـة عـام
              </div>
              <div class="letterhead-doc-meta">
                <div class="letterhead-doc-meta-item">رقم القيد: <strong>${je.entry_no}</strong></div>
                <div class="letterhead-doc-meta-item">التاريخ: <strong>${je.date}</strong></div>
                <div class="letterhead-doc-meta-item">المرجع: <strong>${je.reference_type || 'يدوي'} ${je.reference_no ? '(' + je.reference_no + ')' : ''}</strong></div>
              </div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; margin: 12px 0;">
              <strong>البيان العام: </strong> <span>${je.description || '-'}</span>
            </div>

            <table class="custom-table" style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85rem;">
              <thead>
                <tr style="background: #f1f5f9; color: #1e293b; border-bottom: 2px solid #94a3b8;">
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 12%;">رقم الحساب</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; width: 25%;">اسم الحساب</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; width: 18%;">مركز التكلفة</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 13%;">مدين (منه)</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 13%;">دائن (له)</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; width: 19%;">البيان</th>
                </tr>
              </thead>
              <tbody>
                ${(je.lines || []).map(l => `
                  <tr>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${l.account_code || '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${l.account_name || '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right;">${l.cost_center_name || '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: left; direction: ltr; font-weight: bold; color: #047857;">${Number(l.debit) > 0 ? App.formatNumber(l.debit) : '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: left; direction: ltr; font-weight: bold; color: #0369a1;">${Number(l.credit) > 0 ? App.formatNumber(l.credit) : '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right;">${l.description || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background: #e2e8f0; font-weight: bold;">
                  <td colspan="3" style="padding: 8px; border: 1px solid #94a3b8; text-align: left;">الإجمالي المتزن:</td>
                  <td style="padding: 8px; border: 1px solid #94a3b8; text-align: left; direction: ltr; color: #047857;">${App.formatNumber(je.total_debit)}</td>
                  <td style="padding: 8px; border: 1px solid #94a3b8; text-align: left; direction: ltr; color: #0369a1;">${App.formatNumber(je.total_credit)}</td>
                  <td style="padding: 8px; border: 1px solid #94a3b8; text-align: center;">${je.currency || 'ر.ي'}</td>
                </tr>
              </tfoot>
            </table>

            <div style="margin-top: 10px; font-size: 0.85rem; color: #475569;">
              <strong>المبلغ كتابة: </strong> فقط: ${words} لا غير.
            </div>
          </div>

          <div style="margin-top: 40px;">
            <div class="letterhead-signatures-row">
              <div class="letterhead-sig-col">
                <div class="letterhead-sig-label">إعداد المحاسب</div>
                <div class="letterhead-sig-dots">التوقيع: ........................</div>
              </div>
              <div class="letterhead-sig-col">
                <div class="letterhead-sig-label">المراجعة والتدقيق</div>
                <div class="letterhead-sig-dots">المراجع: ........................</div>
              </div>
              <div class="letterhead-sig-col">
                <div class="letterhead-sig-label">اعتماد المدير المالي / الإدارة</div>
                <div class="letterhead-sig-dots">الاعتماد: ........................</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`قيد يومية - ${je.entry_no}`);
    }
    window.print();
  },

  // ================== إدارة تبويبات الحسابات الشاملة (Journal & Accounts Hub) ==================
  switchJournalTab(tabId) {
    this.activeJournalTab = tabId;
    ['journalEntries', 'chartOfAccounts', 'costCenters', 'currencies'].forEach(t => {
      const btn = document.getElementById(`tabBtn_${t}`);
      const pane = document.getElementById(`pane_${t}`);
      if (btn) btn.classList.toggle('active', t === tabId);
      if (pane) pane.style.display = (t === tabId) ? 'block' : 'none';
    });

    const actionBtn = document.getElementById('btnNewJournalAction');
    if (actionBtn) {
      if (tabId === 'journalEntries') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة قيد يومية جديد +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewJournalModal()');
      } else if (tabId === 'chartOfAccounts') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة حساب مالي جديد +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewAccountModal()');
      } else if (tabId === 'costCenters') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة مركز تكلفة +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewCostCenterModal()');
      } else if (tabId === 'currencies') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة عملة جديدة +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewCurrencyModal()');
      }
    }

    if (tabId === 'journalEntries') {
      this.loadJournalEntries();
    } else if (tabId === 'chartOfAccounts') {
      this.loadChartOfAccounts();
    } else if (tabId === 'costCenters') {
      this.loadCostCentersTable();
    } else if (tabId === 'currencies') {
      this.loadCurrenciesTable();
    }
  },

  refreshCurrentJournalTab() {
    if (this.activeJournalTab === 'chartOfAccounts') {
      this.loadChartOfAccounts();
    } else if (this.activeJournalTab === 'costCenters') {
      this.loadCostCentersTable();
    } else if (this.activeJournalTab === 'currencies') {
      this.loadCurrenciesTable();
    } else {
      this.loadJournalEntries();
    }
  },

  // 1. دليل الحسابات الشجري
  // 1. دليل الحسابات الشجري - دعم كامل للتعديل، الحذف، التقييد والترقيم من الرتبة الثالثة
  async loadChartOfAccounts() {
    try {
      const res = await fetch('/api/accounting/accounts');
      const json = await res.json();
      if (json.success) {
        this.allAccounts = json.data || [];
        this.renderAccountsTable(this.allAccounts);
        this.populateParentSelects();
      }
    } catch (e) {
      console.error('Error loading accounts:', e);
      App.showToast('فشل تحميل دليل الحسابات', 'error');
    }
  },

  populateParentSelects() {
    const parentSelect = document.getElementById('modalAccParentSelect');
    if (parentSelect && Array.isArray(this.allAccounts)) {
      parentSelect.innerHTML = '<option value="">اختر الحساب الأب لتوليد الكود المقترح تلقائياً (أو اتركه فارغاً)...</option>' +
        this.allAccounts.map(a => `<option value="${a.id}" data-code="${a.code}" data-type="${a.type}">[رتبة ${a.level || 1}] ${a.code} - ${a.name} (${a.type})</option>`).join('');
    }
  },

  renderAccountsTable(accounts) {
    const tbody = document.getElementById('chartOfAccountsTableBody');
    if (!tbody) return;

    if (!accounts || accounts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد حسابات مسجلة في الدليل</td></tr>`;
      return;
    }

    const typeBadges = {
      'أصول': 'background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);',
      'خصوم': 'background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);',
      'حقوق ملكية': 'background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3);',
      'إيرادات': 'background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);',
      'مصروفات': 'background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);',
      'تكاليف': 'background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.3);'
    };

    const levelBadges = {
      1: '<span class="badge" style="background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3);">رتبة 1 (رئيسي)</span>',
      2: '<span class="badge" style="background: rgba(234,179,8,0.15); color: #facc15; border: 1px solid rgba(234,179,8,0.3);">رتبة 2 (مجموعة)</span>',
      3: '<span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">رتبة 3 (فرعي)</span>',
      4: '<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3);">رتبة 4+ (تحليلي/قيود)</span>'
    };

    tbody.innerHTML = accounts.map(a => {
      const isRestricted = a.status === 'restricted' || a.status === 'inactive';
      const isLeaf = a.is_leaf || a.children_count === 0;
      const levelBadge = levelBadges[a.level] || levelBadges[4];
      const leafIndicator = isLeaf ? '<span title="حساب طرفي مستخدم لتسجيل القيود والسندات" style="cursor:help; margin-right: 4px;">🎯</span>' : '<span title="حساب تجميعي عام" style="cursor:help; margin-right: 4px;">📂</span>';

      return `
      <tr style="${isRestricted ? 'opacity: 0.65; background: rgba(239,68,68,0.03);' : ''}">
        <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">
          ${leafIndicator} ${a.code || a.account_code}
        </td>
        <td>
          <strong style="${isRestricted ? 'text-decoration: line-through;' : ''}">${a.name || a.account_name}</strong>
          ${a.parent_name ? `<div style="font-size: 0.75rem; color: var(--text-secondary);">تابع لـ: ${a.parent_code} - ${a.parent_name}</div>` : ''}
        </td>
        <td><span class="badge" style="${typeBadges[a.type || a.account_type] || 'background: #334155; color: #fff;'}">${a.type || a.account_type}</span></td>
        <td>${levelBadge}</td>
        <td style="font-weight: bold; font-family: monospace; direction: ltr; text-align: left;">${App.formatNumber(a.current_balance || a.balance || 0)} ر.ي</td>
        <td style="text-align: center;">
          ${isRestricted 
            ? '<span class="badge" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4);">🔒 موقوف / مقيد</span>' 
            : '<span class="badge badge-active">نشط</span>'}
        </td>
        <td style="text-align: center; white-space: nowrap;">
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button class="btn btn-sm btn-secondary" onclick="Accounting.openEditAccountModal(${a.id})" title="تعديل بيانات الحساب" style="padding: 2px 7px; font-size: 0.78rem;">
              ✏️ تعديل
            </button>
            <button class="btn btn-sm" onclick="Accounting.toggleAccountStatus(${a.id})" title="${isRestricted ? 'فك التقييد وتنشيط الحساب' : 'تقييد وتوقيف الحساب'}" style="padding: 2px 7px; font-size: 0.78rem; ${isRestricted ? 'background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3);' : 'background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);'}">
              ${isRestricted ? '🔓 تنشيط' : '🔒 تقييد'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="Accounting.deleteAccount(${a.id}, '${(a.code || '').replace(/'/g, "\\'")}', '${(a.name || '').replace(/'/g, "\\'")}')" title="حذف الحساب من الدليل" style="padding: 2px 7px; font-size: 0.78rem;">
              🗑️
            </button>
          </div>
        </td>
      </tr>
      `;
    }).join('');
  },

  filterAccountsTable() {
    const q = document.getElementById('accountSearchInput')?.value?.toLowerCase()?.trim() || '';
    const filtered = (this.allAccounts || []).filter(a => {
      const code = String(a.code || a.account_code || '').toLowerCase();
      const name = String(a.name || a.account_name || '').toLowerCase();
      const type = String(a.type || a.account_type || '').toLowerCase();
      return !q || code.includes(q) || name.includes(q) || type.includes(q);
    });
    this.renderAccountsTable(filtered);
  },

  openNewAccountModal() {
    const c = document.getElementById('modalAccCode');
    const n = document.getElementById('modalAccName');
    const t = document.getElementById('modalAccType');
    const p = document.getElementById('modalAccParentSelect');
    const s = document.getElementById('modalAccStatus');
    const b = document.getElementById('modalAccBalance');
    if (c) c.value = '';
    if (n) n.value = '';
    if (t) t.value = 'أصول';
    if (p) p.value = '';
    if (s) s.value = 'active';
    if (b) b.value = '0';
    this.populateParentSelects();
    this.suggestAccountCode();
    App.openModal('accountModal');
  },

  onNewAccountParentChange() {
    const parentSelect = document.getElementById('modalAccParentSelect');
    const typeSelect = document.getElementById('modalAccType');
    if (parentSelect && parentSelect.selectedIndex > 0) {
      const opt = parentSelect.options[parentSelect.selectedIndex];
      const parentType = opt.getAttribute('data-type');
      if (parentType && typeSelect) {
        typeSelect.value = parentType;
      }
    }
    this.suggestAccountCode();
  },

  async suggestAccountCode() {
    const parentSelect = document.getElementById('modalAccParentSelect');
    const typeSelect = document.getElementById('modalAccType');
    const codeInput = document.getElementById('modalAccCode');
    if (!codeInput) return;

    const parent_id = parentSelect ? parentSelect.value : '';
    const type = typeSelect ? typeSelect.value : 'أصول';

    try {
      const url = `/api/accounting/suggest-code?type=${encodeURIComponent(type)}${parent_id ? `&parent_id=${parent_id}` : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.suggested_code) {
        codeInput.value = json.suggested_code;
      }
    } catch (e) {
      console.warn('Could not suggest code:', e);
    }
  },

  async submitNewAccount(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('modalAccCode')?.value?.trim();
    const name = document.getElementById('modalAccName')?.value?.trim();
    const type = document.getElementById('modalAccType')?.value?.trim();
    const parent_id = document.getElementById('modalAccParentSelect')?.value || null;
    const status = document.getElementById('modalAccStatus')?.value || 'active';
    const balance = parseFloat(document.getElementById('modalAccBalance')?.value) || 0;

    if (!code || !name || !type) {
      App.showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, type, parent_id, status, balance })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت إضافة الحساب [${code} - ${name}] بنجاح، ومتاح الآن فوراً في السندات والقيود`, 'success');
        App.closeModal('accountModal');
        await this.loadChartOfAccounts();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل حفظ الحساب', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ الحساب', 'error');
    }
  },

  openEditAccountModal(id) {
    const acc = (this.allAccounts || []).find(a => a.id == id);
    if (!acc) {
      App.showToast('لم يتم العثور على الحساب المالي', 'error');
      return;
    }

    document.getElementById('editAccId').value = acc.id;
    document.getElementById('editAccCode').value = acc.code || acc.account_code || '';
    document.getElementById('editAccName').value = acc.name || acc.account_name || '';
    if (document.getElementById('editAccType')) {
      document.getElementById('editAccType').value = acc.type || acc.account_type || 'أصول';
    }
    if (document.getElementById('editAccStatus')) {
      document.getElementById('editAccStatus').value = acc.status || 'active';
    }
    if (document.getElementById('editAccBalance')) {
      document.getElementById('editAccBalance').value = acc.balance || acc.current_balance || 0;
    }

    const parentSelect = document.getElementById('editAccParentSelect');
    if (parentSelect && Array.isArray(this.allAccounts)) {
      parentSelect.innerHTML = '<option value="">بدون أب (حساب رئيسي أعلى مستوى)...</option>' +
        this.allAccounts
          .filter(a => a.id != acc.id)
          .map(a => `<option value="${a.id}" ${acc.parent_id == a.id ? 'selected' : ''}>[رتبة ${a.level || 1}] ${a.code} - ${a.name}</option>`)
          .join('');
    }

    App.openModal('editAccountModal');
  },

  async submitEditAccount(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('editAccId')?.value;
    const code = document.getElementById('editAccCode')?.value?.trim();
    const name = document.getElementById('editAccName')?.value?.trim();
    const type = document.getElementById('editAccType')?.value?.trim();
    const parent_id = document.getElementById('editAccParentSelect')?.value || null;
    const status = document.getElementById('editAccStatus')?.value || 'active';
    const balance = parseFloat(document.getElementById('editAccBalance')?.value) || 0;

    if (!id || !code || !name) {
      App.showToast('يرجى ملء جميع الحقول الإلزامية', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/accounting/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, type, parent_id, status, balance })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم تحديث بيانات الحساب [${code} - ${name}] بنجاح`, 'success');
        App.closeModal('editAccountModal');
        await this.loadChartOfAccounts();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل تحديث الحساب', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء تحديث الحساب', 'error');
    }
  },

  async toggleAccountStatus(id) {
    try {
      const res = await fetch(`/api/accounting/accounts/${id}/toggle-status`, {
        method: 'PATCH'
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadChartOfAccounts();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل تغيير حالة الحساب', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ في الاتصال بالخادم', 'error');
    }
  },

  async deleteAccount(id, code, name) {
    if (!confirm(`هل أنت متأكد من رغبتك في حذف الحساب [${code} - ${name}] نهائياً من دليل الحسابات؟\n\nتنبيه: إذا كان الحساب مرتبطاً بأي قيود يومية، أو سندات قبض/صرف، أو له حسابات فرعية، سيرفض النظام حذفه للحفاظ على سلامة الدفاتر ويمكنك تقييده (توقيفه) بدلاً من ذلك.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/accounting/accounts/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message || 'تم حذف الحساب بنجاح', 'success');
        await this.loadChartOfAccounts();
        await this.loadDropdowns();
      } else {
        alert(`تعذر حذف الحساب:\n${data.message || 'يحتوي على ارتباطات مالية سابقة'}`);
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ أثناء محاولة الحذف', 'error');
    }
  },

  // 2. مراكز التكلفة للمشاريع والعمليات - دعم التعديل والحذف والتقييد
  async loadCostCentersTable() {
    try {
      const res = await fetch('/api/accounting/cost-centers');
      const json = await res.json();
      if (json.success) {
        this.costCenters = json.data || [];
        this.renderCostCentersTable(this.costCenters);
      }
    } catch (e) {
      console.error('Error loading cost centers:', e);
      App.showToast('فشل تحميل مراكز التكلفة', 'error');
    }
  },

  renderCostCentersTable(items) {
    const tbody = document.getElementById('costCentersTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد مراكز تكلفة مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => {
      const isInactive = c.status === 'inactive';
      return `
      <tr style="${isInactive ? 'opacity: 0.65; background: rgba(239,68,68,0.03);' : ''}">
        <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${c.code}</td>
        <td><strong>${c.name}</strong></td>
        <td><span class="badge badge-info">${c.type || 'مشروع'}</span></td>
        <td>${c.project_name ? `<strong>${c.project_name}</strong>` : '<span style="color: var(--text-secondary);">عام</span>'}</td>
        <td style="text-align: center;">
          ${isInactive 
            ? '<span class="badge" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4);">موقوف</span>' 
            : '<span class="badge badge-active">نشط</span>'}
        </td>
        <td style="color: var(--text-secondary);">${c.notes || '-'}</td>
        <td style="text-align: center; white-space: nowrap;">
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button class="btn btn-sm btn-secondary" onclick="Accounting.openEditCostCenterModal(${c.id})" title="تعديل مركز التكلفة" style="padding: 2px 7px; font-size: 0.78rem;">
              ✏️ تعديل
            </button>
            <button class="btn btn-sm btn-danger" onclick="Accounting.deleteCostCenter(${c.id}, '${(c.code || '').replace(/'/g, "\\'")}', '${(c.name || '').replace(/'/g, "\\'")}')" title="حذف مركز التكلفة" style="padding: 2px 7px; font-size: 0.78rem;">
              🗑️
            </button>
          </div>
        </td>
      </tr>
      `;
    }).join('');
  },

  filterCostCentersTable() {
    const q = document.getElementById('costCenterSearchInput')?.value?.toLowerCase()?.trim() || '';
    const filtered = (this.costCenters || []).filter(c => {
      const code = String(c.code || '').toLowerCase();
      const name = String(c.name || '').toLowerCase();
      const proj = String(c.project_name || '').toLowerCase();
      return !q || code.includes(q) || name.includes(q) || proj.includes(q);
    });
    this.renderCostCentersTable(filtered);
  },

  openNewCostCenterModal() {
    const c = document.getElementById('modalCcCode');
    const n = document.getElementById('modalCcName');
    const t = document.getElementById('modalCcType');
    const notes = document.getElementById('modalCcNotes');
    if (c) c.value = '';
    if (n) n.value = '';
    if (t) t.value = 'مشروع';
    if (notes) notes.value = '';

    const pSel = document.getElementById('modalCcProjectSelect');
    if (pSel && Array.isArray(this.projects)) {
      pSel.innerHTML = '<option value="">بدون مشروع (عام)...</option>' +
        this.projects.map(p => `<option value="${p.id}">${p.code ? p.code + ' - ' : ''}${p.name}</option>`).join('');
    }

    App.openModal('costCenterModal');
  },

  async submitNewCostCenter(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('modalCcCode')?.value?.trim();
    const name = document.getElementById('modalCcName')?.value?.trim();
    const type = document.getElementById('modalCcType')?.value?.trim() || 'مشروع';
    const project_id = document.getElementById('modalCcProjectSelect')?.value || null;
    const notes = document.getElementById('modalCcNotes')?.value?.trim() || null;

    if (!name) {
      App.showToast('يرجى كتابة اسم مركز التكلفة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/cost-centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, type, project_id, notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت إضافة مركز التكلفة [${data.data?.code || ''} ${name}] بنجاح`, 'success');
        App.closeModal('costCenterModal');
        await this.loadCostCentersTable();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل حفظ مركز التكلفة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ مركز التكلفة', 'error');
    }
  },

  openEditCostCenterModal(id) {
    const cc = (this.costCenters || []).find(c => c.id == id);
    if (!cc) {
      App.showToast('لم يتم العثور على مركز التكلفة', 'error');
      return;
    }

    document.getElementById('editCcId').value = cc.id;
    document.getElementById('editCcCode').value = cc.code || '';
    document.getElementById('editCcName').value = cc.name || '';
    if (document.getElementById('editCcType')) {
      document.getElementById('editCcType').value = cc.type || 'مشروع';
    }
    if (document.getElementById('editCcStatus')) {
      document.getElementById('editCcStatus').value = cc.status || 'active';
    }
    if (document.getElementById('editCcNotes')) {
      document.getElementById('editCcNotes').value = cc.notes || '';
    }

    const pSel = document.getElementById('editCcProjectSelect');
    if (pSel && Array.isArray(this.projects)) {
      pSel.innerHTML = '<option value="">بدون مشروع (عام)...</option>' +
        this.projects.map(p => `<option value="${p.id}" ${cc.project_id == p.id ? 'selected' : ''}>${p.code ? p.code + ' - ' : ''}${p.name}</option>`).join('');
    }

    App.openModal('editCostCenterModal');
  },

  async submitEditCostCenter(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('editCcId')?.value;
    const code = document.getElementById('editCcCode')?.value?.trim();
    const name = document.getElementById('editCcName')?.value?.trim();
    const type = document.getElementById('editCcType')?.value?.trim() || 'مشروع';
    const project_id = document.getElementById('editCcProjectSelect')?.value || null;
    const status = document.getElementById('editCcStatus')?.value || 'active';
    const notes = document.getElementById('editCcNotes')?.value?.trim() || null;

    if (!id || !code || !name) {
      App.showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/accounting/cost-centers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, type, project_id, status, notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم تعديل مركز التكلفة [${code} - ${name}] بنجاح`, 'success');
        App.closeModal('editCostCenterModal');
        await this.loadCostCentersTable();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل تحديث مركز التكلفة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء تحديث مركز التكلفة', 'error');
    }
  },

  async deleteCostCenter(id, code, name) {
    if (!confirm(`هل أنت متأكد من رغبتك في حذف مركز التكلفة [${code} - ${name}]؟\n\nإذا كانت هناك أي قيود محاسبية أو سندات قبض/صرف تستخدمه، سيرفض النظام الحذف لضمان صحة تقارير التكاليف.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/accounting/cost-centers/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message || 'تم حذف مركز التكلفة بنجاح', 'success');
        await this.loadCostCentersTable();
        await this.loadDropdowns();
      } else {
        alert(`تعذر حذف مركز التكلفة:\n${data.message || 'مرتبط بعمليات سابقة'}`);
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ أثناء محاولة الحذف', 'error');
    }
  },

  // 3. تهيئة العملات وأسعار الصرف
  async loadCurrenciesTable() {
    try {
      const res = await fetch('/api/accounting/currencies');
      const json = await res.json();
      if (json.success) {
        this.currencies = json.data || [];
        this.renderCurrenciesTable(this.currencies);
      }
    } catch (e) {
      console.error('Error loading currencies:', e);
      App.showToast('فشل تحميل جدول العملات', 'error');
    }
  },

  renderCurrenciesTable(items) {
    const tbody = document.getElementById('currenciesTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد عملات مهيأة</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => {
      const rate = Number(c.exchange_rate ?? c.rate_to_base ?? 1.0);
      const isDefault = Boolean(c.is_default || c.is_base || c.code === 'YER');
      return `
      <tr>
        <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${c.code}</td>
        <td><strong>${c.name}</strong></td>
        <td style="font-weight: bold;">${c.symbol || '-'}</td>
        <td style="font-family: monospace; font-weight: bold; color: var(--accent-green); font-size: 1.05rem; direction: ltr; text-align: left;">
          ${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} YER
        </td>
        <td>${isDefault ? '<span class="badge badge-active">عملة الأساس الرئيسية (1.0)</span>' : '<span class="badge badge-info">عملة أجنبية</span>'}</td>
        <td style="text-align: center;">
          ${isDefault ? '<span style="color: var(--text-secondary); font-size: 0.8rem;">أساس (ثابت)</span>' : `
            <button class="btn btn-sm btn-secondary" onclick="Accounting.quickUpdateCurrencyRate(${c.id}, ${rate})" title="تعديل سعر الصرف اليومي">
              ✏️ تحديث السعر
            </button>
          `}
        </td>
      </tr>
    `;
    }).join('');
  },

  openNewCurrencyModal() {
    const c = document.getElementById('modalCurrCode');
    const n = document.getElementById('modalCurrName');
    const s = document.getElementById('modalCurrSymbol');
    const r = document.getElementById('modalCurrRate');
    if (c) c.value = '';
    if (n) n.value = '';
    if (s) s.value = '';
    if (r) r.value = '1.0';
    App.openModal('currencyModal');
  },

  async submitNewCurrency(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('modalCurrCode')?.value?.trim()?.toUpperCase();
    const name = document.getElementById('modalCurrName')?.value?.trim();
    const symbol = document.getElementById('modalCurrSymbol')?.value?.trim();
    const exchange_rate = parseFloat(document.getElementById('modalCurrRate')?.value) || 1.0;

    if (!code || !name) {
      App.showToast('يرجى ملء كود واسم العملة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/currencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, symbol, rate_to_base: exchange_rate, exchange_rate })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت إضافة العملة [${code} - ${name}] بنجاح`, 'success');
        App.closeModal('currencyModal');
        await this.loadCurrenciesTable();
      } else {
        App.showToast(data.message || 'فشل حفظ العملة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ العملة', 'error');
    }
  },

  async quickUpdateCurrencyRate(id, currentRate) {
    const defaultVal = (!currentRate || isNaN(currentRate)) ? '' : String(currentRate);
    const newRateStr = prompt(`أدخل سعر الصرف الجديد مقابل الريال اليمني (YER):\nالسعر الحالي: ${defaultVal || 'غير محدد'}`, defaultVal);
    if (!newRateStr) return;
    const rate = parseFloat(newRateStr.replace(/,/g, '').trim());
    if (isNaN(rate) || rate <= 0) {
      App.showToast('سعر الصرف غير صحيح، يرجى إدخال رقم موجب', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/accounting/currencies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate_to_base: rate, exchange_rate: rate })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم تحديث سعر الصرف بنجاح ✅', 'success');
        await this.loadCurrenciesTable();
      } else {
        App.showToast(data.message || 'فشل التحديث', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ أثناء التحديث', 'error');
    }
  },

  // أسماء مستعارة لتوافق التنقل والشاشات
  loadAccounts() {
    return this.loadChartOfAccounts();
  },

  loadCostCenters() {
    return this.loadCostCentersTable();
  },

  loadCurrencies() {
    return this.loadCurrenciesTable();
  },

  // ================== إدارة الفترات المحاسبية وإغلاق الحسابات ==================
  async openPeriodsModal() {
    let modal = document.getElementById('accountingPeriodsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'accountingPeriodsModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-box" style="max-width: 850px; width: 95%;">
          <div class="modal-header">
            <h3 class="modal-title" style="display: flex; align-items: center; gap: 8px;">
              <span>🔒 إدارة الفترات المحاسبية وإغلاق الدفاتر</span>
            </h3>
            <button type="button" class="modal-close-btn" onclick="App.closeModal('accountingPeriodsModal')">&times;</button>
          </div>
            <div class="modal-body">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.88rem;">
                  إغلاق الفترات يمنع تسجيل أو تعديل أي قيد أو سند مالي بتاريخ مغلق لحماية الحسابات من التلاعب.
                </p>
                <button class="btn btn-sm btn-primary" onclick="Accounting.showNewPeriodForm()">+ إضافة فترة جديدة</button>
              </div>

              <!-- نموذج إضافة فترة جديدة (مخفي افتراضياً) -->
              <div id="newPeriodFormContainer" style="display: none; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 15px;">
                <h4 style="font-size: 0.95rem; margin-bottom: 10px; color: var(--gold-light);">إضافة فترة محاسبية جديدة</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px;">
                  <div>
                    <label class="form-label" style="font-size: 0.8rem;">اسم الفترة</label>
                    <input type="text" id="newPeriodName" class="form-control" placeholder="مثال: الربع الأول 2026">
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.8rem;">تاريخ البدء</label>
                    <input type="date" id="newPeriodStart" class="form-control">
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.8rem;">تاريخ الانتهاء</label>
                    <input type="date" id="newPeriodEnd" class="form-control">
                  </div>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                  <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('newPeriodFormContainer').style.display='none'">إلغاء</button>
                  <button type="button" class="btn btn-sm btn-success" onclick="Accounting.submitNewPeriod()">حفظ الفترة</button>
                </div>
              </div>

              <div class="table-responsive">
                <table class="custom-table">
                  <thead>
                    <tr>
                      <th>اسم الفترة</th>
                      <th>تاريخ البدء</th>
                      <th>تاريخ الانتهاء</th>
                      <th>الحالة</th>
                      <th>ملاحظات الإغلاق / الفتح</th>
                      <th style="text-align: center;">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody id="accountingPeriodsTableBody">
                    <tr><td colspan="6" style="text-align: center;">جاري التحميل...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal('accountingPeriodsModal')">إغلاق</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    App.openModal('accountingPeriodsModal');
    await this.loadPeriodsTable();
  },

  showNewPeriodForm() {
    const el = document.getElementById('newPeriodFormContainer');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  async loadPeriodsTable() {
    const tbody = document.getElementById('accountingPeriodsTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/accounting/periods');
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">لا توجد فترات محاسبية مسجلة</td></tr>';
        return;
      }

      tbody.innerHTML = json.data.map(p => {
        const isClosed = p.status === 'closed';
        const badge = isClosed 
          ? `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid #ef4444;">🔒 مغلقة</span>`
          : `<span class="badge" style="background: rgba(34,197,94,0.2); color: #4ade80; border: 1px solid #22c55e;">🟢 مفتوحة</span>`;

        let actionBtn = '';
        if (isClosed) {
          actionBtn = `<button class="btn btn-sm btn-warning" onclick="Accounting.promptReopenPeriod(${p.id}, '${p.period_name}')" style="padding: 3px 8px; font-size: 0.78rem;">🔓 إعادة فتح</button>`;
        } else {
          actionBtn = `<button class="btn btn-sm btn-danger" onclick="Accounting.promptClosePeriod(${p.id}, '${p.period_name}')" style="padding: 3px 8px; font-size: 0.78rem;">🔒 إغلاق الفترة</button>`;
        }

        const notes = isClosed 
          ? `أغلقت بواسطة: ${p.closed_by || 'المدير'} ${p.closing_reason ? `(${p.closing_reason})` : ''}`
          : (p.reopen_reason ? `أعيد فتحها: ${p.reopen_reason}` : 'جاهزة للعمليات');

        return `
          <tr>
            <td style="font-weight: bold; color: #fff;">${p.period_name}</td>
            <td>${p.start_date}</td>
            <td>${p.end_date}</td>
            <td>${badge}</td>
            <td style="font-size: 0.8rem; color: var(--text-secondary);">${notes}</td>
            <td style="text-align: center;">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #f87171;">فشل جلب الفترات المحاسبية</td></tr>';
    }
  },

  async submitNewPeriod() {
    const period_name = document.getElementById('newPeriodName')?.value?.trim();
    const start_date = document.getElementById('newPeriodStart')?.value;
    const end_date = document.getElementById('newPeriodEnd')?.value;

    if (!period_name || !start_date || !end_date) {
      App.showToast('جميع الحقول مطلوبة لإضافة الفترة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_name, start_date, end_date })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تمت إضافة الفترة المحاسبية بنجاح', 'success');
        document.getElementById('newPeriodFormContainer').style.display = 'none';
        await this.loadPeriodsTable();
      } else {
        App.showToast(data.message || 'فشل إضافة الفترة', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ أثناء حفظ الفترة', 'error');
    }
  },

  async promptClosePeriod(id, name) {
    const reason = prompt(`هل أنت متأكد من إغلاق الفترة المحاسبية (${name})؟\nلن يسمح بأي تعديل مالي فيها بعد الإغلاق.\nأدخل سبب الإغلاق إن وجد:`, 'الإقفال الدوري للحسابات');
    if (reason === null) return;

    try {
      const res = await fetch(`/api/accounting/periods/${id}/close`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadPeriodsTable();
      } else {
        App.showToast(data.message || 'فشل إغلاق الفترة', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ في إغلاق الفترة', 'error');
    }
  },

  async promptReopenPeriod(id, name) {
    const reason = prompt(`⚠️ إعادة فتح فترة مغلقة (${name}) يتطلب إذناً رسمياً.\nأدخل سبب ومبرر إعادة الفتح:`);
    if (!reason || !reason.trim()) {
      App.showToast('يجب إدخال سبب رسمي لإعادة فتح الفترة', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/accounting/periods/${id}/reopen`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadPeriodsTable();
      } else {
        App.showToast(data.message || 'فشل إعادة فتح الفترة', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ في إعادة فتح الفترة', 'error');
    }
  },

  // ================== سجل التدقيق والرقابة المالية (Audit Log) ==================
  async showAuditLogsModal() {
    return this.openAuditLogModal();
  },

  async openAuditLogModal() {
    let modal = document.getElementById('auditLogModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'auditLogModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-box" style="max-width: 1050px; width: 95%;">
          <div class="modal-header">
            <h3 class="modal-title" style="display: flex; align-items: center; gap: 8px;">
              <span>📜 سجل التدقيق والرقابة المالية (Audit Trail)</span>
            </h3>
            <button type="button" class="modal-close-btn" onclick="App.closeModal('auditLogModal')">&times;</button>
          </div>
            <div class="modal-body">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.88rem;">
                  توثيق دقيق لكل العمليات المالية والإدارية (من أنشأ، من عدّل، متى، والتفاصيل المحاسبية).
                </p>
                <div style="display: flex; gap: 10px; align-items: center;">
                  <select id="auditLogFilterEntity" class="form-control" style="max-width: 170px;" onchange="Accounting.loadAuditLogs()">
                    <option value="">كافة الكيانات...</option>
                    <option value="journal_entry">قيود يومية</option>
                    <option value="expense">سندات صرف</option>
                    <option value="receipt">سندات قبض</option>
                    <option value="payroll">رواتب وأجور</option>
                    <option value="period">فترات محاسبية</option>
                    <option value="account">دليل الحسابات</option>
                  </select>
                  <button class="btn btn-sm btn-secondary" onclick="Accounting.loadAuditLogs()">🔄 تحديث</button>
                </div>
              </div>

              <div class="table-responsive">
                <table class="custom-table">
                  <thead>
                    <tr>
                      <th>التاريخ والوقت</th>
                      <th>المستخدم</th>
                      <th>نوع الحركة</th>
                      <th>الكيان المالي</th>
                      <th>الرقم / المعرف</th>
                      <th>تفاصيل التعديل والبيانات</th>
                      <th>عنوان IP</th>
                    </tr>
                  </thead>
                  <tbody id="auditLogsTableBody">
                    <tr><td colspan="7" style="text-align: center;">جاري التحميل...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal('auditLogModal')">إغلاق</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    App.openModal('auditLogModal');
    await this.loadAuditLogs();
  },

  async loadAuditLogs() {
    const tbody = document.getElementById('auditLogsTableBody');
    if (!tbody) return;

    const entityType = document.getElementById('auditLogFilterEntity')?.value || '';
    let url = '/api/accounting/audit-logs?limit=50';
    if (entityType) url += `&entity_type=${encodeURIComponent(entityType)}`;

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">لا توجد حركات تدقيق مسجلة حتى الآن</td></tr>';
        return;
      }

      tbody.innerHTML = json.data.map(log => {
        let actionBadge = `<span class="badge badge-info">${log.action}</span>`;
        if (log.action === 'INSERT') actionBadge = `<span class="badge" style="background: rgba(34,197,94,0.2); color: #4ade80;">إضافة +</span>`;
        else if (log.action === 'DELETE') actionBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;">حذف ✕</span>`;
        else if (log.action === 'UPDATE') actionBadge = `<span class="badge" style="background: rgba(234,179,8,0.2); color: #facc15;">تعديل ✏️</span>`;
        else if (log.action === 'CLOSE_PERIOD') actionBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;">إغلاق فترة 🔒</span>`;
        else if (log.action === 'REOPEN_PERIOD') actionBadge = `<span class="badge" style="background: rgba(59,130,246,0.2); color: #60a5fa;">فتح فترة 🔓</span>`;

        let detailsDisplay = log.details || '';
        try {
          if (detailsDisplay.startsWith('{') || detailsDisplay.startsWith('[')) {
            const parsed = JSON.parse(detailsDisplay);
            detailsDisplay = Object.entries(parsed)
              .map(([k, v]) => `<span style="color: var(--gold-light);">${k}:</span> ${typeof v === 'number' ? App.formatNumber(v) : v}`)
              .join(' | ');
          }
        } catch (e) {}

        return `
          <tr>
            <td style="font-size: 0.8rem; direction: ltr; text-align: right;">${log.created_at}</td>
            <td style="font-weight: 600; color: #fff;">${log.username || 'نظام'}</td>
            <td>${actionBadge}</td>
            <td><span class="badge badge-secondary">${log.entity_type}</span></td>
            <td style="font-family: monospace; color: #38bdf8;">${log.entity_id || '-'}</td>
            <td style="font-size: 0.8rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${detailsDisplay}</td>
            <td style="font-size: 0.75rem; color: var(--text-secondary); direction: ltr;">${log.ip_address || '-'}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #f87171;">فشل جلب سجلات التدقيق</td></tr>';
    }
  },

  // ============================================================
  // 🔒 إدارة الفترات المحاسبية وإقفال الحسابات (Period Closing)
  // ============================================================
  async loadPeriods() {
    const tbody = document.getElementById('accountingPeriodsTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/accounting/periods');
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">لا توجد فترات محاسبية مسجلة</td></tr>';
        return;
      }

      tbody.innerHTML = json.data.map(p => {
        const isClosed = p.status === 'closed';
        const badge = isClosed
          ? `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;">مغلقة رسمياً 🔒</span>`
          : `<span class="badge" style="background: rgba(34,197,94,0.2); color: #4ade80;">مفتوحة للعمليات 🟢</span>`;

        const actionBtn = isClosed
          ? `<button type="button" class="btn btn-secondary btn-sm" data-action="reopen-period" data-period-id="${p.id}" onclick="Accounting.reopenPeriod(${p.id})">إعادة فتح 🔓</button>`
          : `<button type="button" class="btn btn-danger btn-sm" data-action="close-period-modal" data-period-id="${p.id}" data-period-name="${p.period_name}" onclick="Accounting.openClosePeriodModal(${p.id}, '${p.period_name}', '${p.start_date}', '${p.end_date}')">إقفال الفترة 🔒</button>`;

        return `
          <tr>
            <td><strong>${p.period_name}</strong></td>
            <td>${p.fiscal_year}</td>
            <td>${p.start_date}</td>
            <td>${p.end_date}</td>
            <td>${badge}</td>
            <td style="font-size: 0.85rem; color: var(--text-secondary);">${isClosed ? (p.closed_by || 'المدير المالي') : '—'}</td>
            <td>${actionBtn}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error('Error loading periods:', e);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #f87171;">تعذر تحميل الفترات المحاسبية</td></tr>';
    }
  },

  openClosePeriodModal(periodId, periodName, startDate = '', endDate = '') {
    let modal = document.getElementById('periodCloseModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'periodCloseModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-box" style="max-width: 540px;">
          <div class="modal-header" style="background: linear-gradient(135deg, #1e293b, #0f172a); border-bottom: 2px solid #ef4444;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.4rem;">🔒</span>
              <h3 style="color: #ef4444; margin: 0;">إقفال الفترة المحاسبية نهائياً</h3>
            </div>
            <button type="button" class="btn-close" data-action="close-modal" data-modal="periodCloseModal" onclick="App.closeModal('periodCloseModal')">&times;</button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <div style="background: rgba(239,68,68,0.1); border: 1.5px solid #ef4444; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px;">
              <strong style="color: #ef4444; font-size: 0.95rem; display: block; margin-bottom: 4px;">⚠️ تحذير مالي ورقابي صارم:</strong>
              <div style="font-size: 0.84rem; color: #e2e8f0; line-height: 1.6;">
                إقفال الفترة المحاسبية سيقفل بشكل نهائي كافة القيود والسندات والفواتير وحركات المخزون والمصروفات الواقعة ضمن تواريخ هذه الفترة، وسيمنع أي تعديل أو إضافة أو حذف إلا بتفويض رسمي مبرر.
              </div>
            </div>

            <div style="margin-bottom: 14px; background: rgba(255,255,255,0.03); padding: 10px 14px; border-radius: 6px; border: 1px solid var(--border-color);">
              <div>الفترة المستهدفة: <strong id="closePeriodNameLabel" style="color: #fff;">-</strong></div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;" id="closePeriodRangeLabel">-</div>
            </div>

            <form id="formClosePeriod" onsubmit="Accounting.submitClosePeriod(event)">
              <input type="hidden" id="closePeriodId">
              
              <div class="form-group" style="margin-bottom: 14px;">
                <label style="color: #f3cf65; font-weight: 700;">كلمة مرور المدير المالي / المشرف (إلزامية للتفويض) *</label>
                <input type="password" id="closePeriodManagerPassword" class="form-control" required placeholder="أدخل كلمة مرور الإدارة للمصادقة" autocomplete="current-password">
              </div>

              <div class="form-group" style="margin-bottom: 16px;">
                <label>ملاحظات أو مبررات الإقفال</label>
                <textarea id="closePeriodNotes" class="form-control" rows="2" placeholder="مثال: إقفال الربع المالي ومطابقة أرصدة البنوك والعملاء"></textarea>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button type="button" class="btn btn-secondary" onclick="App.closeModal('periodCloseModal')">إلغاء</button>
                <button type="submit" id="btnConfirmClosePeriod" class="btn btn-danger" style="background: #dc2626; border-color: #dc2626; font-weight: 700;">
                  تأكيد الإقفال القانوني 🔒
                </button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('closePeriodId').value = periodId;
    document.getElementById('closePeriodNameLabel').textContent = periodName;
    document.getElementById('closePeriodRangeLabel').textContent = startDate && endDate ? `من ${startDate} إلى ${endDate}` : '';
    document.getElementById('closePeriodManagerPassword').value = '';
    document.getElementById('closePeriodNotes').value = '';

    this.checkUnpostedItemsForPeriod(periodId);
    App.openModal('periodCloseModal');
  },

  async submitClosePeriod(event) {
    if (event) event.preventDefault();
    const periodId = document.getElementById('closePeriodId')?.value;
    const password = document.getElementById('closePeriodManagerPassword')?.value;
    const notes = document.getElementById('closePeriodNotes')?.value;
    const submitBtn = document.getElementById('btnConfirmClosePeriod');

    if (!periodId) return;
    if (!password || !password.trim()) {
      if (window.UI && UI.Toast) UI.Toast.error('يرجى إدخال كلمة مرور المدير لإقرار إقفال الفترة');
      return;
    }

    if (window.UI && UI.Loading) UI.Loading.set(submitBtn, true, 'جاري التحقق والإقفال...');

    try {
      const res = await fetch(`/api/accounting/periods/${periodId}/close`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_password: password.trim(), notes: notes?.trim() })
      });
      const json = await res.json();

      if (json.success) {
        if (window.UI && UI.Toast) UI.Toast.success(json.message);
        else App.showToast(json.message, 'success');
        App.closeModal('periodCloseModal');
        await this.loadPeriods();
      } else {
        if (window.UI && UI.Toast) UI.Toast.error(json.message);
        else App.showToast(json.message, 'error');
      }
    } catch (e) {
      console.error(e);
      if (window.UI && UI.Toast) UI.Toast.error('فشل الاتصال بالخادم لإقفال الفترة');
    } finally {
      if (window.UI && UI.Loading) UI.Loading.set(submitBtn, false);
    }
  },

  async reopenPeriod(periodId) {
    const reason = prompt('يرجى إدخال مبرر رسمي لإعادة فتح الفترة المحاسبية المغلقة:');
    if (!reason || !reason.trim()) return;

    try {
      const res = await fetch(`/api/accounting/periods/${periodId}/reopen`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const json = await res.json();
      if (json.success) {
        if (window.UI && UI.Toast) UI.Toast.success(json.message);
        else App.showToast(json.message, 'success');
        await this.loadPeriods();
      } else {
        if (window.UI && UI.Toast) UI.Toast.error(json.message);
        else App.showToast(json.message, 'error');
      }
    } catch (e) {
      console.error(e);
      if (window.UI && UI.Toast) UI.Toast.error('تعذر إعادة فتح الفترة');
    }
  },

  async checkUnpostedItemsForPeriod(periodId) {
    const badge = document.getElementById('closePeriodUnpostedBadge');
    const details = document.getElementById('closePeriodUnpostedDetails');
    const btn = document.getElementById('btnPostAllInPeriod');
    if (!badge || !details || !btn) return;

    badge.textContent = 'جاري الفحص...';
    badge.style.background = 'rgba(56, 189, 248, 0.2)';
    badge.style.color = '#38bdf8';
    details.innerHTML = 'جاري التحقق من القيود وسندات الصرف والقبض المعلقة...';
    btn.style.display = 'none';

    try {
      const res = await fetch(`/api/accounting/periods/${periodId}/unposted-items`);
      const data = await res.json();
      if (!data.success) {
        details.textContent = 'تعذر فحص العناصر غير المرحلة.';
        return;
      }
      const { counts, total_unposted } = data;
      if (total_unposted === 0) {
        badge.textContent = '✓ جميع العمليات مرحلة';
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#10b981';
        details.innerHTML = '<span style="color: #10b981;">✓ جميع قيود اليومية وسندات الصرف والقبض ضمن نطاق هذه الفترة مرحلة ومعتمدة بالكامل، يمكنك الإقفال بأمان.</span>';
        btn.style.display = 'none';
      } else {
        badge.textContent = `⚠️ يوجد ${total_unposted} عملية غير مرحلة`;
        badge.style.background = 'rgba(239, 68, 68, 0.2)';
        badge.style.color = '#ef4444';
        details.innerHTML = `
          <div style="margin-bottom: 6px; color: #f87171;">
            يوجد عمليات لم يتم ترحيلها بعد ضمن تواريخ هذه الفترة:
          </div>
          <ul style="margin: 0 16px; padding: 0; color: #cbd5e1; list-style-type: square;">
            <li>قيود اليومية غير المرحلة (مسودة): <strong>${counts.unposted_journals}</strong></li>
            <li>سندات الصرف غير المرحلة: <strong>${counts.unposted_expenses}</strong></li>
            <li>سندات القبض غير المرحلة: <strong>${counts.unposted_payments}</strong></li>
          </ul>
        `;
        btn.style.display = 'block';
      }
    } catch (e) {
      console.error(e);
      details.textContent = 'حدث خطأ أثناء فحص العمليات غير المرحلة.';
    }
  },

  async postAllUnpostedInCurrentPeriod() {
    const periodId = document.getElementById('closePeriodId')?.value;
    if (!periodId) return;
    const btn = document.getElementById('btnPostAllInPeriod');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الترحيل الشامل... ⏳';
    }

    try {
      const res = await fetch(`/api/accounting/periods/${periodId}/post-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message || 'تم ترحيل كافة السندات والقيود بنجاح', 'success');
        await this.checkUnpostedItemsForPeriod(periodId);
        if (this.loadJournalEntries) this.loadJournalEntries();
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء الترحيل', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('فشل الاتصال بالخادم لترحيل السندات والقيود', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '⚡ ترحيل كافة السندات والقيود المعلقة لهذه الفترة دفعة واحدة';
      }
    }
  },

  async exportJournalToExcel() {
    if (typeof ExcelExporter === 'undefined' || !ExcelExporter.download) {
      App.showToast('ميزة التصدير لـ Excel غير متوفرة حالياً', 'info');
      return;
    }

    try {
      App.showToast('جاري تجهيز وتصدير دفتر القيود اليومية المفصل...', 'info');

      // جلب الفلتر المطبق حالياً إن وجد
      const refFilter = document.getElementById('journalRefFilter')?.value || '';
      let url = '/api/accounting/journal-entries/export-data';
      if (refFilter) {
        url += `?reference_type=${encodeURIComponent(refFilter)}`;
      }

      const res = await fetch(url);
      const json = await res.json();

      if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
        App.showToast('لا توجد بيانات قيود للتصدير', 'warning');
        return;
      }

      const rows = json.data;
      const { companyName, phone, slogan } = ExcelExporter.getCompanyInfo();
      const exportDate = new Date().toISOString().split('T')[0];

      let totalDebitOrig = 0;
      let totalCreditOrig = 0;
      let totalDebitLocal = 0;
      let totalCreditLocal = 0;

      const tableRowsHtml = rows.map((r, index) => {
        const dOrig = Number(r.debit) || 0;
        const cOrig = Number(r.credit) || 0;
        const dLocal = Number(r.local_debit) || 0;
        const cLocal = Number(r.local_credit) || 0;

        totalDebitOrig += dOrig;
        totalCreditOrig += cOrig;
        totalDebitLocal += dLocal;
        totalCreditLocal += cLocal;

        // الطرف المقابل (عميل أو مورد)
        let partyName = '-';
        if (r.client_name && r.client_name.trim()) {
          partyName = `عميل: ${r.client_name}`;
        } else if (r.supplier_name && r.supplier_name.trim()) {
          partyName = `مورد: ${r.supplier_name}`;
        }

        const costCenterDisplay = r.cost_center_name ? `${r.cost_center_code ? '[' + r.cost_center_code + '] ' : ''}${r.cost_center_name}` : '-';
        const projectDisplay = r.project_name || '-';

        return `
          <tr style="${index % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
            <td style="text-align: center; mso-number-format:'\\@';">${index + 1}</td>
            <td style="text-align: center; font-weight: bold; mso-number-format:'\\@';">${r.entry_no || '-'}</td>
            <td style="text-align: center; mso-number-format:'\\@';">${r.entry_date || '-'}</td>
            <td style="text-align: center; font-weight: bold; mso-number-format:'\\@';">${r.account_code || '-'}</td>
            <td style="font-weight: 600; mso-number-format:'\\@';">${r.account_name || 'حساب غير محدد'}</td>
            <td style="mso-number-format:'\\@';">${r.line_notes || r.entry_description || '-'}</td>
            <td style="text-align: left; font-family: Consolas, monospace; mso-number-format:'\\#\\,\\#\\#0\\.00';">${dOrig > 0 ? dOrig.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
            <td style="text-align: left; font-family: Consolas, monospace; mso-number-format:'\\#\\,\\#\\#0\\.00';">${cOrig > 0 ? cOrig.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
            <td style="text-align: center; mso-number-format:'\\@';">${r.currency || 'ر.ي'}</td>
            <td style="text-align: center; mso-number-format:'0\\.00';">${Number(r.exchange_rate) || 1}</td>
            <td style="text-align: left; font-weight: bold; color: #047857; font-family: Consolas, monospace; mso-number-format:'\\#\\,\\#\\#0\\.00';">${dLocal > 0 ? dLocal.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
            <td style="text-align: left; font-weight: bold; color: #b91c1c; font-family: Consolas, monospace; mso-number-format:'\\#\\,\\#\\#0\\.00';">${cLocal > 0 ? cLocal.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
            <td style="mso-number-format:'\\@';">${costCenterDisplay}</td>
            <td style="mso-number-format:'\\@';">${projectDisplay}</td>
            <td style="mso-number-format:'\\@';">${partyName}</td>
            <td style="text-align: center; mso-number-format:'\\@';">${r.reference_type || 'يدوي'}</td>
            <td style="text-align: center; mso-number-format:'\\@';">${r.entry_status === 'posted' ? 'مرحل' : 'مسودة'}</td>
          </tr>
        `;
      }).join('');

      const htmlBody = `
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%; direction: rtl; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;">
          <thead>
            <tr>
              <th colspan="17" style="background-color: #0f2744; color: #d4af37; font-size: 16pt; font-weight: bold; text-align: center; height: 42px;">
                ${companyName}
              </th>
            </tr>
            <tr>
              <th colspan="17" style="background-color: #1a365d; color: #ffffff; font-size: 13pt; font-weight: bold; text-align: center; height: 32px;">
                دفتر قيود اليومية المحاسبية التفصيلي الموحد
              </th>
            </tr>
            <tr>
              <th colspan="17" style="background-color: #f1f5f9; color: #334155; font-size: 9.5pt; text-align: center; height: 25px;">
                تاريخ الاستخراج: ${exportDate} &nbsp;|&nbsp; عدد السطور: ${rows.length} &nbsp;|&nbsp; ${slogan} &nbsp;|&nbsp; هاتف: ${phone}
              </th>
            </tr>
            <tr style="background-color: #1e293b; color: #f8fafc; font-size: 10pt; font-weight: bold; text-align: center;">
              <th style="width: 35px;">م</th>
              <th style="width: 90px;">رقم القيد</th>
              <th style="width: 95px;">التاريخ</th>
              <th style="width: 85px;">رقم الحساب</th>
              <th style="width: 170px;">اسم الحساب المالي</th>
              <th style="width: 220px;">البيان / تفاصيل الحركة</th>
              <th style="width: 105px;">مدين (المعاملة)</th>
              <th style="width: 105px;">دائن (المعاملة)</th>
              <th style="width: 60px;">العملة</th>
              <th style="width: 65px;">سعر الصرف</th>
              <th style="width: 120px; background-color: #064e3b; color: #fff;">مدين (ر.ي محلي)</th>
              <th style="width: 120px; background-color: #7f1d1d; color: #fff;">دائن (ر.ي محلي)</th>
              <th style="width: 130px;">مركز التكلفة</th>
              <th style="width: 120px;">المشروع المرتبط</th>
              <th style="width: 140px;">اسم العميل / المورد</th>
              <th style="width: 85px;">المرجع</th>
              <th style="width: 75px;">الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
          <tfoot>
            <tr style="background-color: #e2e8f0; font-weight: bold; font-size: 10.5pt; border-top: 2.5pt solid #0f2744;">
              <td colspan="6" style="text-align: center; font-weight: bold; mso-number-format:'\\@';">الإجمالي الكلي بالريال اليمني (المحلي)</td>
              <td colspan="4" style="text-align: center; color: #64748b; font-size: 9pt; mso-number-format:'\\@';">مطابقة التوازن المحاسبي</td>
              <td style="text-align: left; font-weight: bold; color: #047857; font-family: Consolas, monospace; mso-number-format:'\\#\\,\\#\\#0\\.00';">
                ${totalDebitLocal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </td>
              <td style="text-align: left; font-weight: bold; color: #b91c1c; font-family: Consolas, monospace; mso-number-format:'\\#\\,\\#\\#0\\.00';">
                ${totalCreditLocal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </td>
              <td colspan="5" style="text-align: center; font-weight: bold; ${Math.abs(totalDebitLocal - totalCreditLocal) < 0.01 ? 'color: #047857;' : 'color: #b91c1c;'} mso-number-format:'\\@';">
                ${Math.abs(totalDebitLocal - totalCreditLocal) < 0.01 ? '✓ القيد والدفتر متزن 100%' : '⚠️ فارق: ' + Math.abs(totalDebitLocal - totalCreditLocal).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      `;

      ExcelExporter.download(htmlBody, `قيود_اليومية_التفصيلية_${exportDate}`, 'دفتر القيود اليومية');
      App.showToast('تم تصدير دفتر القيود اليومية بنجاح إلى ملف Excel', 'success');
    } catch (e) {
      console.error('Error exporting journal entries to Excel:', e);
      App.showToast('حدث خطأ أثناء تصدير قيود اليومية إلى Excel', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.Accounting = Accounting;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Accounting;
}

